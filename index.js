/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI } from "@google/genai";
import { render } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { html } from 'htm/preact';
import { marked } from 'marked';

function App() {
    // UI State
    const [isLoading, setIsLoading] = useState(false); // For AI calls
    const [isRenderingPdf, setIsRenderingPdf] = useState(false); // For client-side PDF rendering
    const [pdfViewerVisible, setPdfViewerVisible] = useState(false);
    const [showApiKeyModal, setShowApiKeyModal] = useState(false);

    // Data State
    const [fileName, setFileName] = useState('');
    const [inputText, setInputText] = useState('');
    const [outputText, setOutputText] = useState('');
    const [chatHistory, setChatHistory] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [isChatting, setIsChatting] = useState(false);
    const [pdfDoc, setPdfDoc] = useState(null);
    const [ai, setAi] = useState(null);
    const [apiKey, setApiKey] = useState('');
    const [tempApiKey, setTempApiKey] = useState('');

    // Refs
    const fileInputRef = useRef(null);
    const chatHistoryRef = useRef(null);
    const pdfViewerRef = useRef(null);

    // API Key Initialization on Load
    useEffect(() => {
        const savedKey = localStorage.getItem('gemini-api-key');
        if (savedKey) {
            setApiKey(savedKey);
            setTempApiKey(savedKey);
            try {
                setAi(new GoogleGenAI({ apiKey: savedKey }));
            } catch (e) {
                console.error("Failed to initialize GoogleGenAI:", e);
                localStorage.removeItem('gemini-api-key');
                setShowApiKeyModal(true);
            }
        } else {
            setShowApiKeyModal(true);
        }
    }, []);

    // Derived State
    const isBusy = isLoading || isRenderingPdf;
    const canUseAi = !isBusy && ai;

    // Scroll chat to bottom
    useEffect(() => {
        if (chatHistoryRef.current) {
            chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
        }
    }, [chatHistory]);

    // Add copy listener to PDF viewer
    useEffect(() => {
        const viewer = pdfViewerRef.current;
        if (!viewer) return;

        const handleCopy = () => {
            const selection = document.getSelection()?.toString().trim();
            if (selection) {
                setInputText(prev => prev ? `${prev}\n\n${selection}` : selection);
                const mainTextarea = document.getElementById('main-textarea');
                if(mainTextarea) {
                    mainTextarea.focus();
                    setTimeout(() => {
                        mainTextarea.scrollTop = mainTextarea.scrollHeight;
                    }, 0);
                }
            }
        };

        viewer.addEventListener('copy', handleCopy);
        return () => viewer.removeEventListener('copy', handleCopy);
    }, [pdfViewerVisible]);

    // Effect for virtualized PDF rendering
    useEffect(() => {
        const viewer = pdfViewerRef.current;
        if (!pdfDoc || !viewer) return;

        let observer;
        const setupVirtualRendering = async () => {
            setIsRenderingPdf(true);
            viewer.innerHTML = '';
            const fragment = document.createDocumentFragment();
            for (let i = 1; i <= pdfDoc.numPages; i++) {
                const page = await pdfDoc.getPage(i);
                const viewport = page.getViewport({ scale: 1.5 });
                const pageContainer = document.createElement('div');
                pageContainer.className = 'page-container';
                pageContainer.dataset.pageNumber = String(i);
                pageContainer.style.width = `${viewport.width}px`;
                pageContainer.style.height = `${viewport.height}px`;
                fragment.appendChild(pageContainer);
            }
            viewer.appendChild(fragment);
            setIsRenderingPdf(false);

            observer = new IntersectionObserver(async (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        const pageContainer = entry.target;
                        observer.unobserve(pageContainer);
                        const pageNum = parseInt(pageContainer.dataset.pageNumber, 10);
                        try {
                            const page = await pdfDoc.getPage(pageNum);
                            const viewport = page.getViewport({ scale: 1.5 });
                            const canvas = document.createElement('canvas');
                            const canvasContext = canvas.getContext('2d');
                            canvas.height = viewport.height;
                            canvas.width = viewport.width;
                            const textLayerDiv = document.createElement('div');
                            textLayerDiv.className = 'textLayer';
                            pageContainer.appendChild(canvas);
                            pageContainer.appendChild(textLayerDiv);
                            await page.render({ canvasContext, viewport }).promise;
                            const textContent = await page.getTextContent();
                            await pdfjsLib.renderTextLayer({
                                textContentSource: textContent,
                                container: textLayerDiv,
                                viewport: viewport,
                                textDivs: [],
                            }).promise;
                        } catch (error) {
                            console.error(`Error rendering page ${pageNum}:`, error);
                            pageContainer.innerHTML = `<div class="placeholder error">渲染第 ${pageNum} 页失败</div>`;
                        }
                    }
                }
            }, { root: viewer, rootMargin: '200px 0px' });
            viewer.querySelectorAll('.page-container').forEach(el => observer.observe(el));
        };
        setupVirtualRendering();
        return () => observer?.disconnect();
    }, [pdfDoc]);

    const handleSaveApiKey = () => {
        if (!tempApiKey.trim()) {
            alert('请输入有效的 API 密钥。');
            return;
        }
        const newApiKey = tempApiKey.trim();
        try {
            const newAi = new GoogleGenAI({ apiKey: newApiKey });
            setAi(newAi);
            setApiKey(newApiKey);
            localStorage.setItem('gemini-api-key', newApiKey);
            setShowApiKeyModal(false);
        } catch (e) {
            console.error("Failed to initialize GoogleGenAI with new key:", e);
            alert("初始化 AI 失败。请检查您的密钥是否正确。");
            localStorage.removeItem('gemini-api-key');
        }
    };
    
    const handleFileChange = async (event) => {
        const file = event.target.files?.[0];
        if (file && file.type === 'application/pdf') {
            setFileName(file.name);
            setPdfViewerVisible(true);
            setPdfDoc(null);
            try {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                setPdfDoc(pdf);
            } catch (error) {
                console.error('Error processing PDF:', error);
                alert('处理PDF文件时出错。');
                closePdf();
            }
        } else if (file) {
            alert('请选择一个PDF文件。');
        }
    };
    
    const handleAiStream = async (contents, target) => {
        if (!ai) {
            const errorMessage = "错误: AI 服务未配置。请点击设置按钮输入您的 API 密钥。";
            if (target === 'chat') {
                setChatHistory(prev => [...prev, { role: 'model', content: errorMessage }]);
            } else {
                setOutputText(errorMessage);
            }
            return;
        }

        setIsLoading(true);
        let fullResponse = '';
        if (target === 'chat') {
            setIsChatting(true);
            setChatHistory(prev => [...prev, { role: 'model', content: '' }]);
        } else {
             setOutputText('');
        }

        try {
            const responseStream = await ai.models.generateContentStream({ model: 'gemini-2.5-flash', contents });
            for await (const chunk of responseStream) {
                const chunkText = chunk.text;
                if (chunkText) {
                    fullResponse += chunkText;
                    if (target === 'chat') {
                        setChatHistory(prev => {
                            const newHistory = [...prev];
                            newHistory[newHistory.length - 1].content = fullResponse;
                            return newHistory;
                        });
                    } else {
                        setOutputText(fullResponse);
                    }
                }
            }
        } catch (error) {
            const errorMessage = `与 AI 通信时发生错误: ${error instanceof Error ? error.message : String(error)}`;
            if (target === 'chat') {
                setChatHistory(prev => {
                    const newHistory = [...prev];
                    if (newHistory.length > 0) newHistory[newHistory.length - 1].content = errorMessage;
                    return newHistory;
                });
            } else {
                setOutputText(errorMessage);
            }
            console.error("Gemini API Error:", error);
        } finally {
            setIsLoading(false);
            if (target === 'chat') setIsChatting(false);
        }
    };

    const handlePolishText = () => {
        if (!inputText.trim()) return alert('请输入需要修改的文本。');
        const prompt = `请仔细修改以下文本，修正其中的错别字、中文语法错误、逻辑问题和不通顺的表达，使其表述更清晰、专业。请直接返回修改后的最终文本，不要添加任何额外的解释或前缀文字。\n\n---\n\n${inputText}`;
        handleAiStream(prompt, 'output');
    };

    const handleOrganizeNotes = () => {
        if (!inputText.trim()) return alert('请输入需要整理的笔记内容。');
        const prompt = `请根据以下笔记内容进行整理和概括，生成一份结构清晰、重点突出的笔记。请在最终输出中，首先展示整理后的笔记，然后附上原始笔记内容以供对照。\n\n请使用以下格式输出:\n\n### 整理后\n[这里是你的整理和概括]\n\n---\n\n### 原始笔记\n[这里是原始笔记内容]\n\n---\n\n**原始笔记内容:**\n\n${inputText}`;
        handleAiStream(prompt, 'output');
    };

    const handleChatSubmit = async (e) => {
        e.preventDefault();
        if (!chatInput.trim() || isBusy) return;
        const newUserMessage = chatInput.trim();
        const updatedHistory = [...chatHistory, { role: 'user', content: newUserMessage }];
        setChatHistory(updatedHistory);
        setChatInput('');
        
        const geminiHistory = updatedHistory.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] }));
        const context = outputText ? `基于以下上下文信息：\n\n---\n${outputText}\n---\n\n` : '';
        const lastMessage = geminiHistory[geminiHistory.length - 1];
        if (context && lastMessage.role === 'user') {
            lastMessage.parts[0].text = `${context}${lastMessage.parts[0].text}`;
        }
        await handleAiStream(geminiHistory, 'chat');
    };
    
    const exportOutputAsTxt = () => {
        if (!outputText) return;
        const blob = new Blob([outputText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `笔记导出-${new Date().toISOString().slice(0,10)}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };
    
    const closePdf = () => {
        setPdfViewerVisible(false);
        setFileName('');
        setPdfDoc(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const renderFormattedText = (content) => {
        const rawHtml = marked.parse(content);
        return html`<div dangerouslySetInnerHTML=${{ __html: rawHtml }}></div>`;
    };

    return html`
        ${showApiKeyModal && html`
            <div class="api-key-modal-overlay">
                <div class="api-key-modal">
                    <h2>输入您的 Gemini API 密钥</h2>
                    <p>
                        要使用 AI 功能，请输入您的 Google Gemini API 密钥。您可以从 
                        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a> 免费获取。
                    </p>
                    <input
                        type="password"
                        placeholder="在此处粘贴您的 API 密钥"
                        value=${tempApiKey}
                        onInput=${e => setTempApiKey(e.target.value)}
                        onKeyDown=${e => e.key === 'Enter' && handleSaveApiKey()}
                    />
                    <button class="primary" onClick=${handleSaveApiKey}>保存并开始</button>
                </div>
            </div>
        `}
        <div class="app-container" style=${{ filter: showApiKeyModal ? 'blur(4px)' : 'none' }}>
            <input type="file" id="file-upload" accept=".pdf" onChange=${handleFileChange} style=${{ display: 'none' }} ref=${fileInputRef} />
            <div class=${`panel pdf-panel ${!pdfViewerVisible ? 'hidden' : ''}`}>
                ${pdfViewerVisible && html`
                    <div class="panel-header">
                         <span class="filename" title=${fileName}>${fileName}</span>
                         <button class="close-button" onClick=${closePdf} aria-label="关闭PDF" disabled=${isBusy}>×</button>
                    </div>
                    <div id="pdf-viewer" class="pdf-viewer" ref=${pdfViewerRef}>
                        ${isRenderingPdf && html`<div class="placeholder">正在准备PDF，请稍候...</div>`}
                    </div>
                `}
            </div>
            <div class="panel main-panel">
                 <div class="main-content-area">
                    <h1>智能写作与笔记助手</h1>
                    <div class="main-workspace">
                        <div class="input-container" style=${{flex: '1', display: 'flex', flexDirection: 'column'}}>
                            <label for="main-textarea">工作区 (可从左侧PDF复制文字至此)</label>
                            <textarea
                                id="main-textarea"
                                placeholder="请在此处输入您的文本，或从PDF复制内容..."
                                value=${inputText}
                                onInput=${(e) => setInputText(e.target.value)}
                                disabled=${isBusy}
                            ></textarea>
                        </div>
                        <div class="action-buttons">
                            <button class="primary" onClick=${handlePolishText} disabled=${!canUseAi || !inputText}>写作修改</button>
                            <button class="primary" onClick=${handleOrganizeNotes} disabled=${!canUseAi || !inputText}>整理笔记</button>
                            <button class="secondary" onClick=${() => fileInputRef.current?.click()} disabled=${isBusy}>上传PDF</button>
                            <button class="secondary settings-btn" onClick=${() => { setTempApiKey(apiKey); setShowApiKeyModal(true); }} disabled=${isBusy} title="修改API Key">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                    <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.858 2.929 2.929 0 0 1 0 5.858z"/>
                                </svg>
                            </button>
                        </div>
                        <div class="output-container">
                            <div class="output-container-header">
                                <span>AI处理结果</span>
                                <button class="secondary" onClick=${exportOutputAsTxt} disabled=${!outputText || isBusy}>导出为 .txt</button>
                            </div>
                            <div class="output-content">
                                ${isLoading && !isChatting ? 'AI正在处理中，请稍候...' : (outputText ? renderFormattedText(outputText) : html`<span style=${{color: 'var(--text-color-secondary)'}}>...</span>`)}
                            </div>
                        </div>
                    </div>
                 </div>
                 <div class="chat-panel">
                     <h2>AI 对话</h2>
                     <div class="chat-history" ref=${chatHistoryRef}>
                         ${chatHistory.length > 0 ? chatHistory.map(msg => html`
                             <div class="chat-message ${msg.role}">
                                 <div class="message-content">
                                     ${renderFormattedText(msg.content)}
                                 </div>
                             </div>
                         `) : html`<div class="placeholder">可以就上方生成的内容进行追问...</div>`}
                     </div>
                     <form class="chat-form" onSubmit=${handleChatSubmit}>
                         <input
                             class="chat-input"
                             placeholder=${ai ? "输入消息..." : "请输入API密钥以启用对话"}
                             value=${chatInput}
                             onInput=${(e) => setChatInput(e.target.value)}
                             disabled=${!canUseAi}
                         />
                         <button type="submit" class="primary" disabled=${!canUseAi || !chatInput.trim()}>
                             ${isLoading && isChatting ? '...' : '发送'}
                         </button>
                     </form>
                </div>
            </div>
        </div>
    `;
}

render(html`<${App} />`, document.getElementById('app'));
