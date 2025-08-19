
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Chat } from '@google/genai';

// pdf.js is loaded from a CDN, so we declare the global variable
declare const pdfjsLib: any;

// Initialize the Gemini API client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
const model = 'gemini-2.5-flash';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'writing' | 'notes'>('writing');
  const [userInput, setUserInput] = useState<string>('');
  const [originalNote, setOriginalNote] = useState<string>('');
  const [aiOutput, setAiOutput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [chatMessage, setChatMessage] = useState<string>('');
  const [isPdfViewerOpen, setIsPdfViewerOpen] = useState<boolean>(false);
  const [chat, setChat] = useState<Chat | null>(null);

  const pdfViewerRef = useRef<HTMLDivElement>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll chat history
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatHistory]);


  useEffect(() => {
    const pdfContainer = pdfViewerRef.current;
    if (pdfContainer && isPdfViewerOpen) {
      const handleCopy = () => {
        const selection = window.getSelection()?.toString();
        if (selection) {
          setUserInput(selection);
          setIsPdfViewerOpen(false); // Close modal on copy
        }
      };
      pdfContainer.addEventListener('copy', handleCopy);
      return () => pdfContainer.removeEventListener('copy', handleCopy);
    }
  }, [isPdfViewerOpen]);

  // Auto-paste on window focus, but only when starting a new task
  useEffect(() => {
    const handleWindowFocus = async () => {
      if (activeTab === 'writing' || (activeTab === 'notes' && !aiOutput)) {
        if (navigator.clipboard && navigator.clipboard.readText) {
          try {
            const clipboardText = await navigator.clipboard.readText();
            if (clipboardText && clipboardText.trim() !== '' && clipboardText !== userInput) {
              setUserInput(clipboardText);
            }
          } catch (err) {
            console.warn('Could not auto-paste from clipboard on focus:', err);
          }
        }
      }
    };

    window.addEventListener('focus', handleWindowFocus);

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [userInput, activeTab, aiOutput]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || file.type !== 'application/pdf') {
      alert('请选择一个 PDF 文件。');
      return;
    }

    const fileReader = new FileReader();
    fileReader.onload = async (e) => {
      const typedarray = new Uint8Array(e.target?.result as ArrayBuffer);
      if (pdfViewerRef.current) {
        pdfViewerRef.current.innerHTML = ''; // Clear previous PDF
      }
      try {
        const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({ canvasContext: context, viewport: viewport }).promise;
          
          const canvasWrapper = document.createElement('div');
          canvasWrapper.style.position = 'relative';

          pdfViewerRef.current?.appendChild(canvasWrapper);
          canvasWrapper.appendChild(canvas);
        }
      } catch (error) {
        console.error('Error rendering PDF:', error);
        alert('渲染 PDF 失败。');
      }
    };
    fileReader.readAsArrayBuffer(file);
  };
  
  const handleProcess = async () => {
    if (!userInput.trim()) return;
    setIsLoading(true);
    setAiOutput('');
    setChatHistory([]);
    setOriginalNote('');
    setChat(null);

    try {
      let prompt = '';
      if (activeTab === 'notes') {
        setOriginalNote(userInput);
        prompt = `请整理以下笔记，提取关键信息，并以结构化的方式（例如使用标题和项目符号）呈现：\n\n${userInput}`;
      } else { // writing
        prompt = `请润色以下文本，使其更清晰、更专业、更具吸引力：\n\n${userInput}`;
      }
      
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });

      const text = response.text;
      setAiOutput(text);

      if (activeTab === 'notes') {
        const newChat = ai.chats.create({
            model,
            history: [
                { role: 'user', parts: [{ text: prompt }] },
                { role: 'model', parts: [{ text }] }
            ]
        });
        setChat(newChat);
      }

    } catch (error) {
      console.error("Error calling Gemini API:", error);
      setAiOutput("处理您的请求时发生错误，请查看控制台了解详情。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = () => {
    if (!originalNote && !aiOutput) return;
    const content = `[原始笔记]\n\n${originalNote}\n\n\n[AI 整理后的笔记]\n\n${aiOutput}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'organized_notes.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || !chat) return;

    const userMessage = { role: 'user' as const, text: chatMessage };
    setChatHistory(prev => [...prev, userMessage]);
    const currentChatMessage = chatMessage;
    setChatMessage('');
    setIsLoading(true);

    try {
      const response = await chat.sendMessage({ message: currentChatMessage });
      const text = response.text;
      const aiMessage = { role: 'ai' as const, text };
      setChatHistory(prev => [...prev, aiMessage]);
    } catch (error) {
        console.error("Error in chat:", error);
        const errorMessage = { role: 'ai' as const, text: "抱歉，我遇到了一个错误。" };
        setChatHistory(prev => [...prev, errorMessage]);
    } finally {
        setIsLoading(false);
    }
  };
  
  const handlePaste = async () => {
    if (!navigator.clipboard?.readText) {
      alert('您的浏览器不支持剪贴板 API。');
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      setUserInput(text);
    } catch (err) {
      console.error('Failed to read clipboard contents: ', err);
      alert('无法读取剪贴板内容。请确保已授予权限。');
    }
  };

  return (
    <>
      <header className="app-header">
        <h1>信息处理助手</h1>
        <button className="btn btn-secondary" onClick={() => setIsPdfViewerOpen(true)}>查看 PDF</button>
      </header>
      <main className="main-container">
        <section className="main-content">
          <div className="card">
            <div className="tabs">
              <button className={`tab ${activeTab === 'writing' ? 'active' : ''}`} onClick={() => setActiveTab('writing')}>写作助手</button>
              <button className={`tab ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => setActiveTab('notes')}>笔记整理</button>
            </div>
            <textarea
              className="textarea"
              placeholder="在此处输入、粘贴 (Ctrl+V)、使用“粘贴”按钮，或从上传的 PDF 复制文本..."
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              aria-label="Text input area"
            />
            <div className="action-buttons">
              <div className="action-buttons-left">
                <button className="btn btn-secondary" onClick={handlePaste} title="从剪贴板粘贴文本">
                  粘贴
                </button>
                <button className="btn btn-primary" onClick={handleProcess} disabled={isLoading && !aiOutput}>
                  {isLoading && !aiOutput ? '处理中...' : (activeTab === 'writing' ? '润色文本' : '整理笔记')}
                </button>
              </div>
              {activeTab === 'notes' && aiOutput && !isLoading && (
                 <button className="btn btn-secondary" onClick={handleExport}>导出为 .txt</button>
              )}
            </div>
          </div>
          {(isLoading && !aiOutput) && (
             <div className="card">
                <div className="loader"><div className="spinner"></div></div>
             </div>
          )}
          {aiOutput && (
            <div className="card">
                <div className="output-container">
                  {activeTab === 'notes' && originalNote && (
                    <>
                      <h3>原始笔记</h3>
                      <pre>{originalNote}</pre>
                      <br/>
                      <h3>AI 整理后的笔记</h3>
                    </>
                  )}
                  {activeTab === 'writing' && <h3>优化后的文本</h3>}
                  <p>{aiOutput}</p>
                </div>
              {activeTab === 'notes' && (
                <div className="chat-container">
                  <div className="chat-history" ref={chatHistoryRef}>
                    {chatHistory.map((msg, index) => (
                      <div key={index} className={`chat-message ${msg.role}`}>{msg.text}</div>
                    ))}
                    {isLoading && chatHistory.length > 0 && chatHistory[chatHistory.length -1].role === 'user' && (
                         <div className="chat-message ai"><div className="loader" style={{padding: '0'}}><div className="spinner"></div></div></div>
                    )}
                  </div>
                  <form className="chat-input-form" onSubmit={handleChat}>
                    <input
                      type="text"
                      className="chat-input"
                      placeholder="提出后续问题..."
                      value={chatMessage}
                      onChange={(e) => setChatMessage(e.target.value)}
                      aria-label="Chat input"
                    />
                    <button type="submit" className="btn btn-primary" disabled={isLoading}>发送</button>
                  </form>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
      {isPdfViewerOpen && (
        <div className="pdf-modal-overlay">
          <div className="pdf-modal-content">
            <div className="pdf-modal-header">
                <h3>PDF 查看器</h3>
                <button className="pdf-modal-close" onClick={() => setIsPdfViewerOpen(false)}>&times;</button>
            </div>
            <div className="pdf-controls">
                <label className="btn btn-primary btn-file-input">
                上传 PDF
                <input type="file" accept=".pdf" onChange={handleFileUpload} />
                </label>
            </div>
            <div className="pdf-viewer" ref={pdfViewerRef}>
                <p>上传 PDF 以在此处查看。选择并复制文本，即可将其自动添加到主输入框。</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
