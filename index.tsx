
import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';


// Configure the worker for react-pdf using a reliable CDN
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

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

type ModelProvider = 'gemini' | 'openai' | 'deepseek';
type ChatMessage = { role: 'user' | 'model', parts: { text: string }[] };


// Utility to normalize line endings for consistent string comparison
const normalizeLineEndings = (str: string) => str.replace(/\r\n/g, '\n');

// Diff calculation utility
const calculateDiff = (original: string, revised: string): { value: string; type: 'added' | 'removed' | 'common' }[] => {
    const originalWords = original.split(/(\s+)/);
    const revisedWords = revised.split(/(\s+)/);

    const matrix = Array(originalWords.length + 1).fill(0).map(() => Array(revisedWords.length + 1).fill(0));

    for (let i = 1; i <= originalWords.length; i++) {
        for (let j = 1; j <= revisedWords.length; j++) {
            if (originalWords[i - 1] === revisedWords[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1] + 1;
            } else {
                matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
            }
        }
    }

    const result: { value: string; type: 'added' | 'removed' | 'common' }[] = [];
    let i = originalWords.length;
    let j = revisedWords.length;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && originalWords[i - 1] === revisedWords[j - 1]) {
            result.unshift({ value: originalWords[i - 1], type: 'common' });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
            result.unshift({ value: revisedWords[j - 1], type: 'added' });
            j--;
        } else if (i > 0 && (j === 0 || matrix[i][j - 1] < matrix[i - 1][j])) {
            result.unshift({ value: originalWords[i - 1], type: 'removed' });
            i--;
        } else {
            // Should not happen, but as a fallback
            break;
        }
    }
    return result;
};


const DiffViewer = ({ original, revised }: { original: string, revised: string }) => {
    const diffs = calculateDiff(original, revised);
    return (
        <div className="diff-viewer" aria-label="文本差异对比视图">
            {diffs.map((diff, index) => (
                <span key={index} className={`diff-${diff.type}`}>
                    {diff.value}
                </span>
            ))}
        </div>
    );
};

const PDFViewer = ({ file, onClose }: { file: File, onClose: () => void }) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isPdfTextBased, setIsPdfTextBased] = useState<boolean | null>(null);
  const [scale, setScale] = useState(1.0); // State for PDF zoom
  const containerRef = useRef<HTMLDivElement>(null);
  const textLayerCheckedRef = useRef(false);

  const ZOOM_STEP = 0.25;
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 2.5;


  useEffect(() => {
    setNumPages(null);
    setPdfError(null);
    setIsPdfTextBased(null);
    textLayerCheckedRef.current = false;
    setScale(1.0); // Reset zoom on new file
  }, [file]);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPdfError(null);
  };
  
  const onDocumentLoadError = (error: Error) => {
    console.error('Failed to load PDF:', error);
    setPdfError('加载PDF文件失败。请确保文件未损坏并重试。');
  };

  const handleZoomIn = () => setScale(prev => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  const handleZoomOut = () => setScale(prev => Math.max(prev - ZOOM_STEP, MIN_ZOOM));

  return (
    <div className="pdf-viewer-panel">
      <div className="pdf-viewer-header">
        <h4 title={file.name}>{file.name}</h4>
        <div className="pdf-zoom-controls">
          <button className="zoom-btn" onClick={handleZoomOut} disabled={scale <= MIN_ZOOM} aria-label="缩小">-</button>
          <span className="zoom-display">{Math.round(scale * 100)}%</span>
          <button className="zoom-btn" onClick={handleZoomIn} disabled={scale >= MAX_ZOOM} aria-label="放大">+</button>
        </div>
        <button onClick={onClose} className="close-btn" aria-label="关闭PDF查看器">&times;</button>
      </div>
      {isPdfTextBased === false && (
        <div className="pdf-warning-message">
            注意: 无法选择文本。此PDF可能为扫描图像。
        </div>
      )}
      <div className="pdf-document-container" ref={containerRef}>
        <Document 
          file={file} 
          onLoadSuccess={onDocumentLoadSuccess} 
          onLoadError={onDocumentLoadError}
          loading={<div className="spinner-container"><div className="spinner"></div></div>}
          error={<div className="error-message">{pdfError || '加载PDF文件时发生未知错误。'}</div>}
        >
          {numPages && !pdfError && containerWidth > 0 && Array.from(new Array(numPages), (el, index) => {
            const pageProps: any = {
              key: `page_${index + 1}`,
              pageNumber: index + 1,
              width: containerWidth,
              scale: scale, // Apply zoom scale
              className: "pdf-page",
            };
            
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

// New Component for Multi-Model Analysis Display
const AnalysisCard = ({ provider, originalText, resultData }: { provider: ModelProvider, originalText: string, resultData?: WritingAnalysis | { error: string } }) => {
    const [isDiffView, setIsDiffView] = useState(false);
    const [copyButtonText, setCopyButtonText] = useState('复制全文');
    const resultsTextAreaRef = useRef<HTMLTextAreaElement>(null);
    
    const handleSaveAsTxt = (textToSave: string) => {
        const blob = new Blob([textToSave], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${provider}_revised_text.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleCopyToClipboard = (textToCopy: string) => {
        navigator.clipboard.writeText(textToCopy).then(() => {
            setCopyButtonText('已复制!');
            setTimeout(() => setCopyButtonText('复制全文'), 2000);
        });
    };

    const renderContent = () => {
        if (!resultData) {
            return <div className="spinner-container"><div className="spinner large"></div></div>;
        }
        if ('error' in resultData) {
            return <div className="error-message">{resultData.error}</div>;
        }
        
        const result = resultData as WritingAnalysis;
        const fullRevisedText = `【 写作建议 】\n\n语法: ${result.grammar}\n错别字: ${result.typos}\n逻辑与清晰度: ${result.logic}\n\n---\n\n【 优化后版本 】\n\n${result.revisedText}`;

        return (
            <div className="revised-text-container">
                {isDiffView ? (
                    <DiffViewer original={originalText} revised={result.revisedText} />
                ) : (
                    <textarea
                        ref={resultsTextAreaRef}
                        className="text-area revised-text-area"
                        value={fullRevisedText}
                        readOnly
                        aria-label={`${provider} revised text and analysis`}
                    />
                )}
                <div className="revised-text-actions">
                    <button className="btn btn-secondary" onClick={() => setIsDiffView(!isDiffView)}>
                        {isDiffView ? '返回编辑' : '对比差异'}
                    </button>
                    <button className="btn btn-secondary" onClick={() => handleSaveAsTxt(fullRevisedText)}>导出为 .txt</button>
                    <button className="btn btn-secondary" onClick={() => handleCopyToClipboard(result.revisedText)}>{copyButtonText}</button>
                </div>
            </div>
        );
    };

    return (
        <div className="analysis-card">
            <h3 className="provider-title">{provider}</h3>
            {renderContent()}
        </div>
    );
};


const App = () => {
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'writing' | 'notes' | null>(null);
  const [analysisResult, setAnalysisResult] = useState<NoteAnalysis | null>(null);
  const [multiAnalysisResults, setMultiAnalysisResults] = useState<{[key in ModelProvider]?: WritingAnalysis | { error: string }}>({});

  const [editableRevisedText, setEditableRevisedText] = useState('');
  const [copyButtonText, setCopyButtonText] = useState('一键复制');
  const [revisedCopyButtonText, setRevisedCopyButtonText] = useState('复制全文');
  const resultsTextAreaRef = useRef<HTMLTextAreaElement>(null);
  
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const pdfFileInputRef = useRef<HTMLInputElement>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userThoughts, setUserThoughts] = useState('');

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  
  const lastPastedTextRef = useRef<string>('');
  
  const [isDiffView, setIsDiffView] = useState(false);
  const [originalTextForDiff, setOriginalTextForDiff] = useState('');

  const [modelProvider, setModelProvider] = useState<ModelProvider>('gemini');

  const apiKeys = {
    gemini: process.env.API_KEY,
    openai: process.env.OPENAI_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
  };

  const isApiKeyInvalid = (provider: ModelProvider) => !apiKeys[provider] || apiKeys[provider] === 'undefined';
  const getApiKeyError = (provider: ModelProvider) => `API 密钥未配置或无效 (${provider.toUpperCase()})。请检查您的环境变量。`;


  const resetForNewText = useCallback((newText: string) => {
    setText(newText);
    setAnalysisResult(null);
    setMultiAnalysisResults({});
    setEditableRevisedText('');
    setChatHistory([]);
    setMode(null);
    setIsDiffView(false);
    lastPastedTextRef.current = normalizeLineEndings(newText);
  }, []);
  
  useEffect(() => {
      if (resultsTextAreaRef.current) {
          resultsTextAreaRef.current.scrollTop = resultsTextAreaRef.current.scrollHeight;
      }
  }, [editableRevisedText]);

  useEffect(() => {
    const clipboardCheckInterval = setInterval(async () => {
        if (document.hasFocus() && !isModalOpen) {
            try {
                const clipboardText = await navigator.clipboard.readText();
                const normalizedClipboardText = normalizeLineEndings(clipboardText);

                if (normalizedClipboardText &&
                    normalizedClipboardText !== lastPastedTextRef.current &&
                    normalizedClipboardText !== normalizeLineEndings(text)) {
                    resetForNewText(clipboardText);
                }
            } catch (err) {}
        }
    }, 500);

    return () => {
        clearInterval(clipboardCheckInterval);
    };
  }, [resetForNewText, isModalOpen, text]);

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
      setMultiAnalysisResults({});
      setEditableRevisedText('');
      setChatHistory([]);
      setIsDiffView(false);
  };
  
  const callGenerativeAi = async (provider: ModelProvider, systemInstruction: string, userPrompt: string, jsonResponse: boolean, history: ChatMessage[] = []) => {
    
    if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: apiKeys.gemini! });
        const config: any = { systemInstruction };

        if (jsonResponse) {
          config.responseMimeType = "application/json";
          if (mode === 'writing') {
            config.responseSchema = { type: Type.OBJECT, properties: { grammar: { type: Type.STRING }, typos: { type: Type.STRING }, logic: { type: Type.STRING }, revisedText: { type: Type.STRING } }, required: ["grammar", "typos", "logic", "revisedText"] };
          } else if (mode === 'notes') {
            config.responseSchema = { type: Type.OBJECT, properties: { title: { type: Type.STRING }, summary: { type: Type.STRING }, organizedPoints: { type: Type.STRING }, combinedText: { type: Type.STRING } }, required: ["title", "summary", "organizedPoints", "combinedText"] };
          }
        }
        
        const contents = [...history, { role: 'user' as const, parts: [{ text: userPrompt }] }];

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents,
            config,
        });

        return response.text;

    } else { // OpenAI and DeepSeek (OpenAI-compatible)
        const apiUrl = provider === 'openai' 
            ? 'https://api.chatanywhere.tech/v1/chat/completions'
            : 'https://api.deepseek.com/chat/completions';
        
        const apiKey = apiKeys[provider];
        
        const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };

        const messages = [
            { role: 'system', content: systemInstruction },
             ...history.map(msg => ({ role: msg.role, content: msg.parts.map(p => p.text).join('\n') })),
            { role: 'user', content: userPrompt }
        ];

        const body: any = {
            model: provider === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat',
            messages,
        };
        if (jsonResponse) {
            body.response_format = { type: "json_object" };
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error (${response.status}): ${errorData.error?.message || 'Unknown error'}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }
  };


  const handleGetWritingSuggestions = async () => {
    if (!text) return;
    resetStateForAnalysis();
    setMode('writing');
    setOriginalTextForDiff(text);
    setIsLoading(true);

    try {
        const userPrompt = `请分析以下中文文本：\n\n${text}`;

        const providers: ModelProvider[] = ['gemini', 'openai', 'deepseek'];
        const promises = providers.map(provider => {
            if (isApiKeyInvalid(provider)) {
                return Promise.reject(new Error(getApiKeyError(provider)));
            }

            let systemInstruction: string;
            
            if (provider !== 'gemini') {
                // For OpenAI compatible APIs, we need to be very specific about the JSON structure
                // as they don't have a robust responseSchema feature like Gemini.
                systemInstruction = 'You are a Chinese writing coach. Analyze the provided text. Respond with a single JSON object containing these exact keys: "grammar" (string analysis of grammar), "typos" (string analysis of typos), "logic" (string analysis of logic and clarity), and "revisedText" (the fully revised text). The entire response must be only the JSON object, with no other text before or after it. The analysis must be in Chinese.';
            } else {
                // Gemini uses responseSchema, so a more general instruction is sufficient.
                systemInstruction = 'You are a Chinese writing coach. Analyze the provided text for grammatical errors, typos, and logical expression issues. Provide a concise summary for each category and a fully revised version of the text. Respond in JSON format. The analysis should be in Chinese.';
            }

            return callGenerativeAi(provider, systemInstruction, userPrompt, true);
        });

        const results = await Promise.allSettled(promises);

        const newResults: { [key in ModelProvider]?: WritingAnalysis | { error: string } } = {};
        results.forEach((result, index) => {
            const provider = providers[index];
            if (result.status === 'fulfilled') {
                try {
                    // Attempt to parse the string, removing potential markdown fences
                    const cleanedResponse = result.value.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
                    const parsed = JSON.parse(cleanedResponse) as WritingAnalysis;
                    // Basic validation to ensure all required fields are strings
                    if (typeof parsed.grammar === 'string' && typeof parsed.typos === 'string' && typeof parsed.logic === 'string' && typeof parsed.revisedText === 'string') {
                       newResults[provider] = parsed;
                    } else {
                       throw new Error('Parsed JSON is missing required string fields.');
                    }
                } catch (e) {
                    console.error(`Failed to parse response from ${provider}:`, result.value, e);
                    newResults[provider] = { error: 'AI返回格式无效或内容不完整。' };
                }
            } else {
                newResults[provider] = { error: result.reason.message };
            }
        });
        setMultiAnalysisResults(newResults);

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
    if (isApiKeyInvalid(modelProvider)) { setError(getApiKeyError(modelProvider)); setIsModalOpen(false); return; };
    if (!text) return;
    setIsModalOpen(false);
    resetStateForAnalysis();
    setMode('notes');

    try {
      const systemInstruction = "You are an information processing assistant. The user has provided fragmented text and their own thoughts. Synthesize both inputs to organize the information. Provide a concise title, a brief summary of the key points, and then list the organized information in a clear, structured format (like bullet points). Finally, provide the combined text of the title and all points. The output should be in Chinese and in JSON format.";
      const combinedPrompt = `这是我从各处复制的碎片化信息：\n---\n${text}\n---\n这是我对此的一些初步想法和要求：\n---\n${userThoughts || '无'}\n---\n请综合以上所有内容，帮我整理成一份清晰的笔记。`;

      const responseText = await callGenerativeAi(modelProvider, systemInstruction, combinedPrompt, true);
      if (!responseText) throw new Error("AI未能返回有效的文本内容。");
      
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

      const initialHistory: ChatMessage[] = [
          { role: 'user', parts: [{ text: `这是我提供的原始信息和我的想法:\n\n原始信息:\n${text}\n\n我的想法:\n${userThoughts || '无'}` }] },
          { role: 'model', parts: [{ text: `我已将您的信息整理如下:\n\n标题: ${result.title}\n\n摘要: ${result.summary}\n\n要点:\n${result.organizedPoints}\n\n您可以针对这些内容继续提问。` }] }
      ];
      setChatHistory(initialHistory);

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
    if (!chatInput.trim() || chatHistory.length === 0 || isChatLoading) return;

    const userMessage = chatInput;
    setChatInput('');
    setIsDiffView(false);

    const chatSeparator = '\n\n--- 对话 ---\n\n';
    const isFirstChatMessage = !editableRevisedText.includes(chatSeparator);
    const prefix = isFirstChatMessage ? chatSeparator : '\n\n';
    const thinkingMessage = '...';

    const fullUserAndLoadingMessage = `${prefix}【我】\n${userMessage}\n\n【AI】\n${thinkingMessage}`;
    setEditableRevisedText(prev => prev + fullUserAndLoadingMessage);
    
    const updatedHistory: ChatMessage[] = [...chatHistory, { role: 'user', parts: [{ text: userMessage }] }];
    setChatHistory(updatedHistory);

    setIsChatLoading(true);
    setError(null);

    try {
        const systemInstruction = mode === 'writing'
          ? 'You are a helpful Chinese writing assistant. Answer the user\'s follow-up questions about the revisions. Respond in Chinese.'
          : 'You are an information assistant. The user has just received an organized version of their notes. Answer their follow-up questions about the content or suggest further refinements. Respond in Chinese.';
        
        const aiMessageContent = await callGenerativeAi(modelProvider, systemInstruction, userMessage, false, chatHistory);

        if (!aiMessageContent) throw new Error("未能获取响应。");

        setEditableRevisedText(prev => prev.slice(0, -(thinkingMessage.length)) + aiMessageContent);
        setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: aiMessageContent }] }]);
    } catch (err) {
        const errorMessage = '消息发送失败，请重试。';
        setEditableRevisedText(prev => prev.slice(0, -(thinkingMessage.length)) + errorMessage);
        setError(errorMessage);
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
    lastPastedTextRef.current = normalizeLineEndings(textToCopy);
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

        <div className="model-selector-container">
            <h4>选择模型 (用于“整理笔记”)</h4>
            <div className="model-selector-group">
                <label>
                    <input type="radio" name="model" value="gemini" checked={modelProvider === 'gemini'} onChange={() => setModelProvider('gemini')} disabled={isLoading || isModalOpen}/>
                    <div className="model-btn">Gemini</div>
                </label>
                <label>
                    <input type="radio" name="model" value="openai" checked={modelProvider === 'openai'} onChange={() => setModelProvider('openai')} disabled={isLoading || isModalOpen}/>
                    <div className="model-btn">OpenAI</div>
                </label>
                <label>
                    <input type="radio" name="model" value="deepseek" checked={modelProvider === 'deepseek'} onChange={() => setModelProvider('deepseek')} disabled={isLoading || isModalOpen}/>
                    <div className="model-btn">DeepSeek</div>
                </label>
            </div>
        </div>
        
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

        {(isLoading || mode) && (
        <div className="content-section">
            <h2>整理修改区</h2>
            {isLoading && <div className="spinner-container"><div className="spinner large"></div></div>}
            
            {!isLoading && mode === 'writing' && (
              <div className="multi-model-results-container">
                {(['gemini', 'openai', 'deepseek'] as ModelProvider[]).map(provider => (
                    <AnalysisCard 
                        key={provider}
                        provider={provider}
                        originalText={originalTextForDiff}
                        resultData={multiAnalysisResults[provider]}
                    />
                ))}
              </div>
            )}

            {!isLoading && mode === 'notes' && analysisResult && (
            <>
              <div className="revised-text-container">
                  {isDiffView ? (
                      <DiffViewer original={originalTextForDiff} revised={(analysisResult as any)?.revisedText || ''} />
                  ) : (
                      <textarea
                          ref={resultsTextAreaRef}
                          className="text-area revised-text-area"
                          value={editableRevisedText}
                          onChange={(e) => setEditableRevisedText(e.target.value)}
                          aria-label="可编辑的最终文本区域"
                      />
                  )}
                  <div className="revised-text-actions">
                      <button className="btn btn-secondary" onClick={handleSaveAsTxt}>导出为 .txt</button>
                      <button className="btn btn-secondary" onClick={() => handleCopyToClipboard(editableRevisedText, 'revised')}>{revisedCopyButtonText}</button>
                  </div>
              </div>
              
              {chatHistory.length > 0 && (
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
