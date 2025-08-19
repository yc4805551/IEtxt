import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type, Chat, GenerateContentResponse } from "@google/genai";
import { Document, Page, pdfjs } from 'react-pdf';

// Configure the worker for react-pdf
pdfjs.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@${pdfjs.version}/build/pdf.worker.mjs`;

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

const CopyIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path fillRule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2Zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6Z"/>
        <path d="M2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2Z"/>
    </svg>
);

const PDFViewer = ({ file, onClose, onTextCopied }: { file: File, onClose: () => void, onTextCopied: (text: string) => void }) => {
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleCopy = () => {
      // Use a short timeout to allow the OS to update the clipboard
      setTimeout(async () => {
        try {
          const copiedText = await navigator.clipboard.readText();
          if (copiedText) {
            onTextCopied(copiedText);
          }
        } catch (err) {
          console.error("Could not read from clipboard:", err);
        }
      }, 100);
    };

    container.addEventListener('copy', handleCopy);

    return () => {
      container.removeEventListener('copy', handleCopy);
    };
  }, [onTextCopied]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };
  
  return (
    <div className="pdf-viewer-panel">
      <div className="pdf-viewer-header">
        <h4 title={file.name}>{file.name}</h4>
        <button onClick={onClose} className="close-btn" aria-label="Close PDF viewer">&times;</button>
      </div>
      {isPdfTextBased === false && (
        <div className="pdf-warning-message">
            Note: Text selection is not available. This PDF appears to be a scanned image.
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
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'writing' | 'notes' | null>(null);
  const [analysisResult, setAnalysisResult] = useState<WritingAnalysis | NoteAnalysis | null>(null);
  const [editableRevisedText, setEditableRevisedText] = useState('');
  const [copyButtonText, setCopyButtonText] = useState('Copy');
  const [revisedCopyButtonText, setRevisedCopyButtonText] = useState('Copy Full Text');
  const [lastPastedText, setLastPastedText] = useState('');
  const [selectedModel, setSelectedModel] = useState<'gemini-2.5-flash' | 'gemini-2.5-pro'>('gemini-2.5-flash');
  
  // PDF state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const pdfFileInputRef = useRef<HTMLInputElement>(null);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userThoughts, setUserThoughts] = useState('');

  // Chat states
  const [chat, setChat] = useState<Chat | null>(null);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model', content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  const resetForNewText = (newText: string) => {
    setText(newText);
    setLastPastedText(newText);
    // Clear everything for a fresh analysis
    setAnalysisResult(null);
    setEditableRevisedText('');
    setChat(null);
    setChatHistory([]);
    setMode(null);
  };

  useEffect(() => {
    const handleFocus = async () => {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
          const textFromClipboard = await navigator.clipboard.readText();
          if (textFromClipboard && textFromClipboard !== lastPastedText) {
            resetForNewText(textFromClipboard);
          }
        }
      } catch (err) {
        console.info('Could not read from clipboard.', err);
      }
    };
    window.addEventListener('focus', handleFocus);
    handleFocus();
    return () => window.removeEventListener('focus', handleFocus);
  }, [lastPastedText]);

  useEffect(() => {
    if (chatHistoryRef.current) {
        chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatHistory, isChatLoading]);
  
  const handlePdfTextCopy = (copiedText: string) => {
    if (copiedText && copiedText !== lastPastedText) {
      resetForNewText(copiedText);
    }
  };

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
      setChatHistory([]);
  };

  const handleGetWritingSuggestions = async () => {
    if (!text) return;
    resetStateForAnalysis();
    setMode('writing');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
        model: selectedModel,
        contents: `请分析以下中文文本：\n\n${text}`,
        config,
      });
      
      let result: WritingAnalysis;
      try {
        result = JSON.parse(response.text.trim()) as WritingAnalysis;
      } catch (parseError) {
        console.error("Failed to parse AI response:", response.text);
        throw new Error("The AI returned an invalid format. Please try again.");
      }

      setAnalysisResult(result);
      const finalContent = `${result.revisedText}\n\n---\n\n【 Original Text 】\n\n${text}`;
      setEditableRevisedText(finalContent);

      const chatConfig = { 
        systemInstruction: 'You are a helpful Chinese writing assistant. Answer the user\'s follow-up questions about the revisions. Respond in Chinese.' 
      };

      // Initialize chat for writing suggestions
      const newChat = ai.chats.create({
          model: selectedModel,
          config: chatConfig,
          history: [
            { role: 'user', parts: [{ text: `这是我写的原文:\n\n${text}` }] },
            { role: 'model', parts: [{ text: `这是我们分析后给出的修改建议和全文:\n\n修改建议:\n语法: ${result.grammar}\n错别字: ${result.typos}\n逻辑表达: ${result.logic}\n\n修订后全文:\n${result.revisedText}` }] }
          ]
      });
      setChat(newChat);
    } catch (err) {
      const errorMessage = (err instanceof Error) ? err.message : 'Failed to analyze text. Please try again.';
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
    if (!text) return;
    setIsModalOpen(false);
    resetStateForAnalysis();
    setMode('notes');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
        model: selectedModel,
        contents: combinedPrompt,
        config,
      });

      let result: NoteAnalysis;
      try {
        result = JSON.parse(response.text.trim()) as NoteAnalysis;
      } catch (parseError) {
        console.error("Failed to parse AI response:", response.text);
        throw new Error("The AI returned an invalid format. Please try again.");
      }

      setAnalysisResult(result);
      const finalContent = `${result.combinedText}\n\n---\n\n【 My Input 】\n\n${userThoughts || 'None'}\n\n---\n\n【 Original Text 】\n\n${text}`;
      setEditableRevisedText(finalContent);

      const chatConfig = {
         systemInstruction: 'You are an information assistant. The user has just received an organized version of their notes based on raw data and their own thoughts. Answer their follow-up questions about the content or suggest further refinements. Respond in Chinese.'
      };

       // Initialize chat for note organization
       const newChat = ai.chats.create({
        model: selectedModel,
        config: chatConfig,
        history: [
            { role: 'user', parts: [{ text: `这是我提供的原始信息和我的想法:\n\n原始信息:\n${text}\n\n我的想法:\n${userThoughts || '无'}` }] },
            { role: 'model', parts: [{ text: `我已将您的信息整理如下:\n\n标题: ${result.title}\n\n摘要: ${result.summary}\n\n要点:\n${result.organizedPoints}\n\n您可以针对这些内容继续提问。` }] }
        ]
      });
      setChat(newChat);

    } catch(err) {
      const errorMessage = (err instanceof Error) ? err.message : 'Failed to organize notes. Please try again.';
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
      setChatHistory(prev => [...prev, { role: 'user', content: userMessage }]);
      setIsChatLoading(true);
      setError(null);
      try {
          const response: GenerateContentResponse = await chat.sendMessage({ message: userMessage });
          setChatHistory(prev => [...prev, { role: 'model', content: response.text }]);
      } catch (err) {
          setError('Failed to send message. Please try again.');
          console.error(err);
          setChatHistory(prev => prev.slice(0, -1));
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
          setRevisedCopyButtonText('Copied!');
          setTimeout(() => setRevisedCopyButtonText('Copy Full Text'), 2000);
        } else {
          setCopyButtonText('Copied!');
          setTimeout(() => setCopyButtonText('Copy'), 2000);
        }
      },
      (err) => {
        setError('Failed to copy.');
        console.error('Copy failed', err);
      }
    );
  };

  const handleCopyChatMessage = (textToCopy: string, index: number) => {
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopiedMessageIndex(index);
      setTimeout(() => {
        setCopiedMessageIndex(null);
      }, 2000);
    }, (err) => {
      setError('Failed to copy.');
      console.error('Copy failed', err);
    });
  };
  
  const renderAnalysisDetail = (detail: string) => {
      if (!detail || detail.trim() === '无' || detail.trim().toLowerCase() === 'none' || detail.trim().toLowerCase().includes('no issues found')) {
          return <p className="no-issues">Looks good! No specific issues found.</p>;
      }
      return <p>{detail}</p>;
  };

  return (
    <div className={`main-layout ${pdfFile ? 'split-view' : 'full-view'}`}>
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Record Your Thoughts</h3>
            <p>Before the AI organizes your notes, write down any initial thoughts, requirements, or key points you want to emphasize.</p>
            <textarea
              className="modal-textarea"
              value={userThoughts}
              onChange={(e) => setUserThoughts(e.target.value)}
              placeholder='e.g., "Focus on market data," or "Organize this into a weekly report..."'
              rows={5}
            />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleProceedWithOrganization}>Proceed</button>
            </div>
          </div>
        </div>
      )}

      {pdfFile && <PDFViewer file={pdfFile} onClose={handleClosePdf} onTextCopied={handlePdfTextCopy} />}
      
      <div className="app-container">
        <div className="app-header">
            <h1>Information Processing Assistant</h1>
            {!pdfFile && (
                <>
                    <input type="file" accept=".pdf" onChange={handlePdfFileChange} ref={pdfFileInputRef} hidden />
                    <button className="btn btn-secondary open-pdf-btn" onClick={triggerPdfFileSelect} aria-label="Open PDF document">
                        Open PDF
                    </button>
                </>
            )}
        </div>

        <div className="model-selector" role="radiogroup" aria-label="Select AI Model">
            <button
                role="radio"
                aria-checked={selectedModel === 'gemini-2.5-pro'}
                className={`model-btn ${selectedModel === 'gemini-2.5-pro' ? 'active' : ''}`}
                onClick={() => setSelectedModel('gemini-2.5-pro')}
                disabled={isLoading || isModalOpen}
            >
                Gemini 2.5 Pro
            </button>
            <button
                role="radio"
                aria-checked={selectedModel === 'gemini-2.5-flash'}
                className={`model-btn ${selectedModel === 'gemini-2.5-flash' ? 'active' : ''}`}
                onClick={() => setSelectedModel('gemini-2.5-flash')}
                disabled={isLoading || isModalOpen}
            >
                Gemini 2.5 Flash
            </button>
        </div>
        
        <div className="input-area-container">
            <p className="instruction-text">
                Paste your text below, or simply focus this window to auto-paste from your clipboard.
            </p>
            <textarea
              className="text-area"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Your text goes here..."
              disabled={isLoading || isModalOpen}
              aria-label="Text input area"
            />
        </div>
        
        {error && <div className="error-message">{error}</div>}
        <div className="button-group">
          <button className="btn btn-secondary" onClick={() => handleCopyToClipboard(text, 'main')} disabled={!text || isLoading || isModalOpen}>
            {copyButtonText}
          </button>
          <button className="btn btn-primary" onClick={handleGetWritingSuggestions} disabled={!text || isLoading || isModalOpen}>
            {isLoading && mode === 'writing' ? <><div className="spinner"></div><span>Analyzing...</span></> : 'Get Writing Suggestions'}
          </button>
          <button className="btn btn-primary" onClick={handleOrganizeNotesClick} disabled={!text || isLoading || isModalOpen}>
            {isLoading && mode === 'notes' ? <><div className="spinner"></div><span>Organizing...</span></> : 'Organize Notes'}
          </button>
        </div>

        {!isLoading && analysisResult && (
          <div className="analysis-container">
              {mode === 'writing' && (analysisResult as WritingAnalysis) &&
                  <>
                      <h2>Writing Suggestions</h2>
                      <div className="analysis-grid">
                          <div className="analysis-card"><h3>Grammar</h3>{renderAnalysisDetail((analysisResult as WritingAnalysis).grammar)}</div>
                          <div className="analysis-card"><h3>Typos</h3>{renderAnalysisDetail((analysisResult as WritingAnalysis).typos)}</div>
                          <div className="analysis-card"><h3>Logic & Clarity</h3>{renderAnalysisDetail((analysisResult as WritingAnalysis).logic)}</div>
                      </div>
                  </>
              }
              {mode === 'notes' && (analysisResult as NoteAnalysis) &&
                  <>
                      <h2>Organized Notes</h2>
                      <div className="analysis-grid">
                          <div className="analysis-card analysis-card-full-width"><h3>Title</h3><p>{(analysisResult as NoteAnalysis).title}</p></div>
                          <div className="analysis-card"><h3>Key Summary</h3>{renderAnalysisDetail((analysisResult as NoteAnalysis).summary)}</div>
                          <div className="analysis-card"><h3>Structured Points</h3>{renderAnalysisDetail((analysisResult as NoteAnalysis).organizedPoints)}</div>
                      </div>
                  </>
              }

              <div className="revised-text-container">
                  <h3>Final Version</h3>
                  <textarea
                      className="text-area revised-text-area"
                      value={editableRevisedText}
                      onChange={(e) => setEditableRevisedText(e.target.value)}
                      aria-label="Editable final text area"
                  />
                  <div className="revised-text-actions">
                      <button className="btn btn-secondary" onClick={handleSaveAsTxt}>Save as .txt</button>
                      <button className="btn btn-secondary" onClick={() => handleCopyToClipboard(editableRevisedText, 'revised')}>{revisedCopyButtonText}</button>
                  </div>
              </div>
              
              {chat && (
                  <div className="chat-container">
                      <h3>Discuss Further</h3>
                      <div className="chat-history" ref={chatHistoryRef}>
                          {chatHistory.map((msg, index) => (
                              <div key={index} className={`chat-message-wrapper ${msg.role}`}>
                                  <div className={`chat-message ${msg.role}-message`}>
                                      <p>{msg.content}</p>
                                  </div>
                                  <button
                                      className={`copy-chat-btn ${copiedMessageIndex === index ? 'copied' : ''}`}
                                      onClick={() => handleCopyChatMessage(msg.content, index)}
                                      title={copiedMessageIndex === index ? "Copied!" : "Copy message"}
                                      aria-label={copiedMessageIndex === index ? "Copied!" : "Copy message"}
                                  >
                                      {copiedMessageIndex === index ?
                                          (<span className="copied-check">✓</span>) :
                                          (<CopyIcon />)
                                      }
                                  </button>
                              </div>
                          ))}
                           {isChatLoading && (
                                <div className="chat-message-wrapper model">
                                    <div className="chat-message model-message">
                                        <div className="spinner-dots"><div></div><div></div><div></div></div>
                                    </div>
                                </div>
                          )}
                      </div>
                      <form className="chat-input-form" onSubmit={handleSendChatMessage}>
                          <input type="text" className="chat-input" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Have questions about the result? Ask here..." disabled={isChatLoading} />
                          <button type="submit" className="btn btn-primary send-btn" disabled={!chatInput.trim() || isChatLoading}>Send</button>
                      </form>
                  </div>
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