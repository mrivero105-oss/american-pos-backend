import { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, MessageCircle, User } from 'lucide-react';
import axios from 'axios';

const CustomerAIChat = ({ companyId, businessName }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([
        { role: 'model', content: `¡Hola! Bienvenido a ${businessName}. ¿En qué podemos ayudarte hoy?` }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        if (isOpen) scrollToBottom();
    }, [messages, isOpen]);

    const handleSend = async (e) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMsg = { role: 'user', content: input.trim() };
        const newHistory = [...messages, userMsg];
        setMessages(newHistory);
        setInput('');
        setIsLoading(true);

        try {
            const currentPort = window.location.port;
            const devPorts = ['5173', '5174', '5175'];
            let targetPort = devPorts.includes(currentPort) ? '3005' : (currentPort || '3005');
            const baseUrl = `${window.location.protocol}//${window.location.hostname}:${targetPort}`;

            // Adapt history format for Gemini
            const apiHistory = messages.map(m => ({
                role: m.role,
                content: m.content
            }));

            const { data } = await axios.post(`${baseUrl}/ai/public-query`, {
                companyId,
                query: userMsg.content,
                history: apiHistory
            });

            setMessages([...newHistory, { role: 'model', content: data.response }]);
        } catch (error) {
            console.error('Error al consultar chat:', error);
            setMessages([...newHistory, { role: 'model', content: "Ups, tuve un problema de conexión. ¿Puedes intentar de nuevo?" }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
            {/* Chat Window */}
            {isOpen && (
                <div className="w-[350px] sm:w-[400px] h-[500px] max-h-[80vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl mb-4 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4">
                    {/* Header */}
                    <div className="bg-sky-600 p-4 flex items-center justify-between shadow-md">
                        <div className="flex items-center gap-3">
                            <div className="bg-white/20 p-2 rounded-full text-white">
                                <MessageCircle size={24} />
                            </div>
                            <div>
                                <h3 className="font-bold text-white leading-tight">Atención al Cliente</h3>
                                <p className="text-xs text-sky-100 flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span> En línea
                                </p>
                            </div>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-sky-100 hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    {/* Messages Body */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/50">
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
                                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${msg.role === 'user' ? 'bg-sky-500 text-white' : 'bg-slate-700 text-sky-300'}`}>
                                    {msg.role === 'user' ? <User size={16} /> : <MessageCircle size={16} />}
                                </div>
                                <div className={`p-3 rounded-2xl text-sm ${msg.role === 'user' ? 'bg-sky-600 text-white rounded-tr-sm' : 'bg-slate-800 border border-slate-700 text-slate-200 rounded-tl-sm'}`}>
                                    <p className="whitespace-pre-wrap">{msg.content}</p>
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex gap-3 max-w-[85%]">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-700 text-sky-300 flex items-center justify-center">
                                    <MessageCircle size={16} />
                                </div>
                                <div className="p-3 bg-slate-800 border border-slate-700 rounded-2xl rounded-tl-sm flex items-center gap-2">
                                    <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce"></span>
                                    <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                    <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Footer */}
                    <div className="p-3 bg-slate-900 border-t border-slate-800">
                        <form onSubmit={handleSend} className="relative flex items-center">
                            <input 
                                type="text"
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                placeholder="Haz tu pregunta..."
                                disabled={isLoading}
                                className="w-full bg-slate-950 border border-slate-700 rounded-full py-2.5 pl-4 pr-12 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                            />
                            <button 
                                type="submit"
                                disabled={!input.trim() || isLoading}
                                className="absolute right-1 p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-full transition-colors"
                            >
                                <Send size={16} />
                            </button>
                        </form>
                        <p className="text-[10px] text-center text-slate-600 mt-2">
                            Impulsado por <span className="text-slate-400 font-semibold">Isaac POS</span>
                        </p>
                    </div>
                </div>
            )}

            {/* Floating Toggle Button */}
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className={`p-4 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-105 ${isOpen ? 'bg-slate-800 text-white border border-slate-700' : 'bg-blue-600 text-white shadow-blue-500/20'}`}
            >
                {isOpen ? <X size={28} /> : <MessageSquare size={28} />}
            </button>
        </div>
    );
};

export default CustomerAIChat;
