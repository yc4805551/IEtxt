
import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type, Chat, GenerateContentResponse } from "@google/genai";
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';


// Configure the worker for react-pdf using the locally installed package
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// Define structures for the two different analysis modes
interface WritingAnalysis {
  grammar: string;
  typos: string;
  logic: string;
  revisedText: string;
}

interface NoteAnalysis {
  title: string;
  summary: string;
  organizedPoints: string;
  combinedText: string;
}

const PDFViewer = ({ file, onClose }: { file: File, onClose: () => void }) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isPdfTextBased, setIsPdfTextBased] = useState<boolean | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textLayerCheckedRef = useRef(false);


  useEffect(() => {
    // Reset pages and detection state when file changes
    setNumPages(null);
    setIsPdfTextBased(null);
    textLayerCheckedRef.current = false;
  }, [file]);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        // Use clientWidth which automatically accounts for padding
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };
  
  return (
    <div className="pdf-viewer-panel">
      <div className="pdf-viewer-header">
        <h4 title={file.name}>{file.name}</h4>
        <button onClick={onClose} className="close-btn" aria-label="关闭PDF查看器">&times;</button>
      </div>
      {isPdfTextBased === false && (
        <div className="pdf-warning-message">
            注意: 无法选择文本。此PDF可能为扫描图像。
        </div>
      )}
      <div className="pdf-document-container" ref={containerRef}>
        <Document file={file} onLoadSuccess={onDocumentLoadSuccess} loading={<div className="spinner-container"><div className="spinner"></div></div>}>
          {numPages && containerWidth > 0 && Array.from(new Array(numPages), (el, index) => {
            const pageProps: any = {
              key: `page_${index + 1}`,
              pageNumber: index + 1,
              width: containerWidth,
              className: "pdf-page",
            };
            
            // Only add listeners to the first page for detection
            if (index === 0) {
              pageProps.onGetTextSuccess = () => {
                if (!textLayerCheckedRef.current) {
                  setIsPdfTextBased(true);
                  textLayerCheckedRef.current = true;
                }
              };
              pageProps.onGetTextError = () => {
                if (!textLayerCheckedRef.current) {
                  setIsPdfTextBased(false);
                  textLayerCheckedRef.current = true;
                }
              };
            }

            return <Page {...pageProps} />;
          })}
        </Document>
      </div>
    </div>
  );
};

const App = () => {
  const apiKey = process.env.API_KEY;
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'writing' | 'notes' | null>(null);
  const [analysisResult, setAnalysisResult] = useState<WritingAnalysis | NoteAnalysis | null>(null);
  const [editableRevisedText, setEditableRevisedText] = useState('');
  const [copyButtonText, setCopyButtonText] = useState('一键复制');
  const [revisedCopyButtonText, setRevisedCopyButtonText] = useState('复制全文');
  const resultsTextAreaRef = useRef<HTMLTextAreaElement>(null);
  
  // PDF state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const pdfFileInputRef = useRef<HTMLInputElement>(null);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userThoughts, setUserThoughts] = useState('');

  // Chat states
  const [chat, setChat] = useState<Chat | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  
  // Auto-paste state
  const lastPastedTextRef = useRef<string>('');

  const resetForNewText = useCallback((newText: string) => {
    setText(newText);
    // Clear everything for a fresh analysis
    setAnalysisResult(null);
    setEditableRevisedText('');
    setChat(null);
    setMode(null);
    // Also update our ref so we don't paste it again
    lastPastedTextRef.current = newText;
  }, []);
  
  // Effect for auto-scrolling the results textarea
  useEffect(() => {
      if (resultsTextAreaRef.current) {
          resultsTextAreaRef.current.scrollTop = resultsTextAreaRef.current.scrollHeight;
      }
  }, [editableRevisedText]);

  // Effect for aggressive auto-pasting from clipboard via polling
  useEffect(() => {
    const clipboardCheckInterval = setInterval(async () => {
        // Only attempt to read clipboard if the document has focus and no modal is open
        if (document.hasFocus() && !isModalOpen) {
            try {
                // The browser will likely require the user to grant permission for this to work automatically.
                // This is a browser security feature that cannot be bypassed by code.
                const clipboardText = await navigator.clipboard.readText();

                if (clipboardText && clipboardText !== lastPastedTextRef.current) {
                    resetForNewText(clipboardText);
                }
            } catch (err) {
                // Silently fail. This is expected if permission is not granted,
                // or if the clipboard is empty or contains non-text data.
            }
        }
    }, 500); // Check every half-second

    return () => {
        clearInterval(clipboardCheckInterval);
    };
  }, [resetForNewText, isModalOpen]);

  const handlePdfFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
        setPdfFile(selectedFile);
    }
  };

  const triggerPdfFileSelect = () => pdfFileInputRef.current?.click();
  const handleClosePdf = () => setPdfFile(null);

  const resetStateForAnalysis = () => {
      setIsLoading(true);
      setError(null);
      setAnalysisResult(null);
      setEditableRevisedText('');
      setChat(null);
  };

  const handleGetWritingSuggestions = async () => {
    if (!text || !apiKey) {
        setError("API 密钥未配置，无法执行分析。");
        return;
    };
    resetStateForAnalysis();
    setMode('writing');

    try {
      const ai = new GoogleGenAI({ apiKey });
      const systemInstruction = 'You are a Chinese writing coach. Analyze the provided text for grammatical errors, typos, and logical expression issues. Provide a concise summary for each category and a fully revised version of the text. Respond in JSON format. The analysis should be in Chinese.';
      
      const config = {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            grammar: { type: Type.STRING, description: "关于语法问题的分析和建议。" },
            typos: { type: Type.STRING, description: "关于错别字问题的分析和建议。" },
            logic: { type: Type.STRING, description: "关于逻辑表达问题的分析和建议。" },
            revisedText: { type: Type.STRING, description: "整合了所有修改建议后的完整文本。" }
          },
          required: ["grammar", "typos", "logic", "revisedText"]
        },
      };

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `请分析以下中文文本：\n\n${text}`,
        config,
      });
      
      const responseText = response.text;
      if (!responseText) {
        throw new Error("AI未能返回有效的文本内容。");
      }

      let result: WritingAnalysis;
      try {
        result = JSON.parse(responseText.trim()) as WritingAnalysis;
      } catch (parseError) {
        console.error("未能解析AI响应:", responseText);
        throw new Error("AI返回格式无效，请重试。");
      }

      setAnalysisResult(result);
      const finalContent = `【 写作建议 】\n\n语法: ${result.grammar}\n错别字: ${result.typos}\n逻辑与清晰度: ${result.logic}\n\n---\n\n【 优化后版本 】\n\n${result.revisedText}\n\n---\n\n【 原文 】\n\n${text}`;
      setEditableRevisedText(finalContent);

      const chatConfig = { 
        systemInstruction: 'You are a helpful Chinese writing assistant. Answer the user\'s follow-up questions about the revisions. Respond in Chinese.' 
      };

      // Initialize chat for writing suggestions
      const newChat = ai.chats.create({
          model: 'gemini-2.5-flash',
          config: chatConfig,
          history: [
            { role: 'user', parts: [{ text: `这是我写的原文:\n\n${text}` }] },
            { role: 'model', parts: [{ text: `这是我们分析后给出的修改建议和全文:\n\n修改建议:\n语法: ${result.grammar}\n错别字: ${result.typos}\n逻辑表达: ${result.logic}\n\n修订后全文:\n${result.revisedText}` }] }
          ]
      });
      setChat(newChat);
    } catch (err) {
      const errorMessage = (err instanceof Error) ? err.message : '分析文本失败，请重试。';
      setError(errorMessage);
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOrganizeNotesClick = () => {
    if (!text) return;
    setUserThoughts('');
    setIsModalOpen(true);
  };

  const handleProceedWithOrganization = async () => {
    if (!text || !apiKey) {
        setError("API 密钥未配置，无法整理笔记。");
        setIsModalOpen(false);
        return;
    };
    setIsModalOpen(false);
    resetStateForAnalysis();
    setMode('notes');

    try {
      const ai = new GoogleGenAI({ apiKey });
      const systemInstruction = "You are an information processing assistant. The user has provided fragmented text and their own thoughts. Synthesize both inputs to organize the information. Provide a concise title, a brief summary of the key points, and then list the organized information in a clear, structured format (like bullet points). Finally, provide the combined text of the title and all points. The output should be in Chinese and in JSON format.";
      
      const combinedPrompt = `
        这是我从各处复制的碎片化信息：
        ---
        ${text}
        ---

        这是我对此的一些初步想法和要求：
        ---
        ${userThoughts || '无'}
        ---

        请综合以上所有内容，帮我整理成一份清晰的笔记。
      `;

      const config = {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "为笔记生成一个简洁的标题。" },
            summary: { type: Type.STRING, description: "对要点进行简短总结。" },
            organizedPoints: { type: Type.STRING, description: "使用要点或编号列表清晰地组织信息。" },
            combinedText: { type: Type.STRING, description: "合并了标题和要点的最终笔记文本，可供保存。" }
          },
          required: ["title", "summary", "organizedPoints", "combinedText"]
        },
      };

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: combinedPrompt,
        config,
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("AI未能返回有效的文本内容。");
      }
      
      let result: NoteAnalysis;
      try {
        result = JSON.parse(responseText.trim()) as NoteAnalysis;
      } catch (parseError) {
        console.error("未能解析AI响应:", responseText);
        throw new Error("AI返回格式无效，请重试。");
      }

      setAnalysisResult(result);
      const finalContent = `【 笔记整理: ${result.title} 】\n\n---\n\n【 核心摘要 】\n${result.summary}\n\n---\n\n【 结构化要点 】\n${result.organizedPoints}\n\n---\n\n【 我的想法 】\n${userThoughts || '无'}\n\n---\n\n【 原文 】\n${text}`;
      setEditableRevisedText(finalContent);

      const chatConfig = {
         systemInstruction: 'You are an information assistant. The user has just received an organized version of their notes based on raw data and their own thoughts. Answer their follow-up questions about the content or suggest further refinements. Respond in Chinese.'
      };

       // Initialize chat for note organization
       const newChat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: chatConfig,
        history: [
            { role: 'user', parts: [{ text: `这是我提供的原始信息和我的想法:\n\n原始信息:\n${text}\n\n我的想法:\n${userThoughts || '无'}` }] },
            { role: 'model', parts: [{ text: `我已将您的信息整理如下:\n\n标题: ${result.title}\n\n摘要: ${result.summary}\n\n要点:\n${result.organizedPoints}\n\n您可以针对这些内容继续提问。` }] }
        ]
      });
      setChat(newChat);

    } catch(err) {
      const errorMessage = (err instanceof Error) ? err.message : '整理笔记失败，请重试。';
      setError(errorMessage);
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };


 const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !chat || isChatLoading) return;

    const userMessage = chatInput;
    setChatInput('');

    const chatSeparator = '\n\n--- 对话 ---\n\n';
    const isFirstChatMessage = !editableRevisedText.includes(chatSeparator);
    const prefix = isFirstChatMessage ? chatSeparator : '\n\n';
    const thinkingMessage = '...';

    // Append user message and a temporary "thinking" indicator
    const fullUserAndLoadingMessage = `${prefix}【我】\n${userMessage}\n\n【AI】\n${thinkingMessage}`;
    setEditableRevisedText(prev => prev + fullUserAndLoadingMessage);

    setIsChatLoading(true);
    setError(null);

    try {
        const response: GenerateContentResponse = await chat.sendMessage({ message: userMessage });
        const aiMessageContent = response.text || "抱歉，未能获取响应。";
        
        // Replace the "thinking..." message with the actual response
        setEditableRevisedText(prev => prev.slice(0, -(thinkingMessage.length)) + aiMessageContent);

    } catch (err) {
        const errorMessage = '消息发送失败，请重试。';
        // Replace the "thinking..." message with the error
        setEditableRevisedText(prev => prev.slice(0, -(thinkingMessage.length)) + errorMessage);
        setError('消息发送失败，请重试。');
        console.error(err);
    } finally {
        setIsChatLoading(false);
    }
};


  const handleSaveAsTxt = () => {
    if (!editableRevisedText) return;
    const blob = new Blob([editableRevisedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    // Try to get title from analysis for filename
    const fileName = (analysisResult && 'title' in analysisResult && analysisResult.title) 
      ? `${analysisResult.title}.txt`
      : 'document.txt';
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyToClipboard = (textToCopy: string, buttonType: 'main' | 'revised') => {
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy).then(() => {
        if (buttonType === 'revised') {
          setRevisedCopyButtonText('已复制!');
          setTimeout(() => setRevisedCopyButtonText('复制全文'), 2000);
        } else {
          setCopyButtonText('已复制!');
          setTimeout(() => setCopyButtonText('一键复制'), 2000);
        }
      },
      (err) => {
        setError('复制失败。');
        console.error('复制失败', err);
      }
    );
  };

  return (
    <div className={`main-layout ${pdfFile ? 'split-view' : 'full-view'}`}>
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>记录你的想法</h3>
            <p>在AI整理笔记之前，请写下您希望强调的任何初步想法、要求或要点。</p>
            <textarea
              className="modal-textarea"
              value={userThoughts}
              onChange={(e) => setUserThoughts(e.target.value)}
              placeholder='例如：“关注市场数据”，或“将此整理成一份周报...”'
              rows={5}
            />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleProceedWithOrganization}>继续</button>
            </div>
          </div>
        </div>
      )}

      {pdfFile && <PDFViewer file={pdfFile} onClose={handleClosePdf} />}
      
      <div className="app-container">
        <div className="app-header">
            <h1>智能写作与笔记助手</h1>
        </div>
        
        <div className="content-section">
            <h2>工作区</h2>
            <p className="instruction-text">
              从PDF或其他应用复制文本，返回此窗口即可自动粘贴。
            </p>
            <textarea
              className="text-area"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="你的文本..."
              disabled={isLoading || isModalOpen}
              aria-label="文本输入区"
            />
        </div>
        
        {error && <div className="error-message">{error}</div>}
        <div className="button-group">
          <button className="btn btn-primary" onClick={handleGetWritingSuggestions} disabled={!text || isLoading || isModalOpen}>
            {isLoading && mode === 'writing' ? <><div className="spinner"></div><span>分析中...</span></> : '写作修改'}
          </button>
          <button className="btn btn-primary" onClick={handleOrganizeNotesClick} disabled={!text || isLoading || isModalOpen}>
            {isLoading && mode === 'notes' ? <><div className="spinner"></div><span>整理中...</span></> : '整理笔记'}
          </button>
          <input type="file" accept=".pdf" onChange={handlePdfFileChange} ref={pdfFileInputRef} hidden />
          <button className="btn btn-secondary" onClick={triggerPdfFileSelect} aria-label="打开PDF文档" disabled={isModalOpen || isLoading}>
              上传 PDF
          </button>
           <button className="btn btn-secondary" onClick={() => handleCopyToClipboard(text, 'main')} disabled={!text || isLoading || isModalOpen}>
            {copyButtonText}
          </button>
        </div>

        {(isLoading || analysisResult) && (
        <div className="content-section">
            <h2>整理修改区</h2>
            {isLoading && <div className="spinner-container"><div className="spinner large"></div></div>}
            {!isLoading && analysisResult && (
            <>
              <div className="revised-text-container">
                  <textarea
                      ref={resultsTextAreaRef}
                      className="text-area revised-text-area"
                      value={editableRevisedText}
                      onChange={(e) => setEditableRevisedText(e.target.value)}
                      aria-label="可编辑的最终文本区域"
                  />
                  <div className="revised-text-actions">
                      <button className="btn btn-secondary" onClick={handleSaveAsTxt}>导出为 .txt</button>
                      <button className="btn btn-secondary" onClick={() => handleCopyToClipboard(editableRevisedText, 'revised')}>{revisedCopyButtonText}</button>
                  </div>
              </div>
              
              {chat && (
                <form className="chat-input-form" onSubmit={handleSendChatMessage}>
                    <input type="text" className="chat-input" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="对结果有疑问？在这里提问..." disabled={isChatLoading} />
                    <button type="submit" className="btn btn-primary send-btn" disabled={!chatInput.trim() || isChatLoading}>发送</button>
                </form>
              )}
            </>
           )}
        </div>
        )}
      </div>
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
}
