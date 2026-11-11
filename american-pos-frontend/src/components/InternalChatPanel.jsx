import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSocket } from '../hooks/SocketContext';
import { useAuth } from '../hooks/AuthContext';
import api from '../services/api';
import { X, Send, User as UserIcon, MessageSquare, Smile, BellRing, Paperclip, Check, CheckCheck, Trash2, Lock, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { playSendSound, playReceiveSound, playUrgentSound } from '../utils/soundUtils';

const InternalChatPanel = ({ isOpen, onClose }) => {
    const { socket } = useSocket();
    const { user } = useAuth();
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [typingUsers, setTypingUsers] = useState({});
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);
    const typingTimeoutRef = useRef(null);
    const [usersList, setUsersList] = useState([]);
    const [selectedTarget, setSelectedTarget] = useState('all');

    const EMOJIS = ['😀','😂','😅','😉','😊','😍','🥰','😎','🤔','🙄','😴','😷','🤯','🥳','🤓','😟','😲','🥺','😢','😭','😤','😡','👍','👎','👏','🙏','💪','🎉','🔥','❤️'];

    // Fetch message history when panel opens
    useEffect(() => {
        if (isOpen) {
            fetchUsersList();
            fetchMessages();
            markAsRead();
        }
    }, [isOpen]);

    const fetchUsersList = async () => {
        try {
            const { data } = await api.get('/users');
            setUsersList(data);
        } catch (error) {
            console.error('Error fetching users:', error);
        }
    };

    const fetchMessages = async () => {
        try {
            setIsLoading(true);
            const { data } = await api.get('/messages');
            setMessages(data);
            scrollToBottom();
        } catch (error) {
            console.error('Error fetching messages:', error);
            toast.error('Error al cargar mensajes');
        } finally {
            setIsLoading(false);
        }
    };

    const markAsRead = async () => {
        if (!user?.id) return;
        try {
            await api.put('/messages/read', { targetRole: user.role, userId: user.id });
            window.dispatchEvent(new CustomEvent('internal_chat_read'));
        } catch (error) {
            console.error('Error marking as read:', error);
        }
    };

    // Listen to realtime messages
    useEffect(() => {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        if (!socket) return;

        const handleNewMessage = (msg) => {
            // Filtrar en caliente si el mensaje no es para mí
            if (user?.role !== 'superadmin' && msg.senderId !== user?.id) {
                if (msg.targetRole !== 'all' && 
                    msg.targetRole !== `user:${user?.id}` && 
                    msg.targetRole !== `role:${(user?.role || '').toLowerCase()}`) {
                    return; // Ignorar, es un mensaje privado ajeno
                }
            }

            setMessages(prev => [...prev, msg]);
            const isZumbido = msg.content === '[ZUMBIDO_URGENTE]';
            
            if (isOpen) {
                markAsRead();
                if (msg.senderId !== user.id) {
                    if (isZumbido) playUrgentSound();
                    else playReceiveSound();
                }
            } else {
                toast.success(isZumbido ? `¡ZUMBIDO de ${msg.sender?.username || 'Admin'}!` : `Nuevo mensaje de ${msg.sender?.username || 'Admin'}`, { duration: 8000 });
                if (isZumbido) playUrgentSound();
                else playReceiveSound();
                
                window.dispatchEvent(new CustomEvent('internal_chat_unread'));
                
                window.focus();
                if ('Notification' in window && Notification.permission === 'granted') {
                    const notification = new Notification("Isaac POS - Mensaje Urgente", {
                        body: `${msg.sender?.username || 'Admin'}: ${isZumbido ? 'ZUMBIDO' : msg.content}`,
                        requireInteraction: true
                    });
                    notification.onclick = () => {
                        window.focus();
                    };
                }
            }
            scrollToBottom();
        };

        const handleTyping = (data) => {
            if (data.userId !== user.id) {
                setTypingUsers(prev => ({ ...prev, [data.userId]: data.username }));
            }
        };

        const handleStopTyping = (data) => {
            setTypingUsers(prev => {
                const next = { ...prev };
                delete next[data.userId];
                return next;
            });
        };

        const handleReadUpdate = () => {
            if (isOpen) fetchMessages(); // Actualiza para ver el check azul
        };

        const handleClear = () => {
            setMessages([]);
            toast.success('El chat ha sido vaciado por un administrador.');
        };

        socket.on('new_internal_chat_message', handleNewMessage);
        socket.on('internal_chat_typing', handleTyping);
        socket.on('internal_chat_stop_typing', handleStopTyping);
        socket.on('internal_chat_read_update', handleReadUpdate);
        socket.on('internal_chat_cleared', handleClear);

        return () => {
            socket.off('new_internal_chat_message', handleNewMessage);
            socket.off('internal_chat_typing', handleTyping);
            socket.off('internal_chat_stop_typing', handleStopTyping);
            socket.off('internal_chat_read_update', handleReadUpdate);
            socket.off('internal_chat_cleared', handleClear);
        };
    }, [socket, isOpen]);

    const scrollToBottom = () => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    };

    const handleTyping = (e) => {
        setNewMessage(e.target.value);
        if (!socket) return;

        socket.emit('internal_chat_typing', { userId: user.id, username: user.username });

        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

        typingTimeoutRef.current = setTimeout(() => {
            socket.emit('internal_chat_stop_typing', { userId: user.id });
        }, 2000);
    };

    const handleSendMessage = async (e) => {
        if (e) e.preventDefault();
        if (!newMessage.trim()) return;

        if (socket) socket.emit('internal_chat_stop_typing', { userId: user.id });

        try {
            await api.post('/messages', {
                senderId: user.id,
                content: newMessage.trim(),
                targetRole: selectedTarget,
                type: 'text'
            });
            playSendSound();
            setNewMessage('');
        } catch (error) {
            console.error('Error sending message:', error);
            toast.error('Error al enviar el mensaje');
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            return toast.error('El archivo excede los 5MB permitidos.');
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            const toastId = toast.loading('Subiendo imagen...');
            const { data } = await api.post('/messages/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            
            await api.post('/messages', {
                senderId: user.id,
                content: '📸 Imagen enviada',
                targetRole: selectedTarget,
                type: 'image',
                fileUrl: data.url
            });
            playSendSound();
            toast.success('Imagen enviada', { id: toastId });
        } catch (error) {
            console.error('Error uploading file:', error);
            toast.error('Error al subir la imagen');
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const insertEmoji = (emoji) => {
        setNewMessage(prev => prev + emoji);
    };

    const sendZumbido = async () => {
        try {
            await api.post('/messages', {
                senderId: user.id,
                content: '[ZUMBIDO_URGENTE]',
                targetRole: selectedTarget,
                type: 'text'
            });
            playSendSound();
            toast.success("Zumbido enviado");
        } catch (_error) {
            toast.error("Error al enviar el zumbido");
        }
    };

    const isMessageReadByOthers = (msg) => {
        if (!msg.readBy || !Array.isArray(msg.readBy)) return false;
        // Check si hay alguien más en el arreglo aparte del remitente
        return msg.readBy.some(id => id !== msg.senderId);
    };

    const typingUsersList = Object.values(typingUsers);

    const handleClearChat = async () => {
        if (!window.confirm('¿Estás seguro de que quieres vaciar todo el historial del chat para todos los usuarios? Esta acción no se puede deshacer.')) {
            return;
        }
        try {
            await api.delete('/messages/clear');
        } catch (error) {
            console.error('Error clearing chat:', error);
            toast.error('Error al vaciar el chat');
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]"
                    />

                    {/* Sliding Panel */}
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed top-0 right-0 h-full w-[400px] bg-slate-900 border-l border-white/10 shadow-2xl z-[101] flex flex-col theme-2025-card"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/20">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
                                    <MessageSquare size={20} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white leading-tight">Chat Interno</h2>
                                    <div className="flex items-center mt-1">
                                        <div className="relative flex items-center bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-md transition-colors cursor-pointer group">
                                            <select 
                                                value={selectedTarget}
                                                onChange={(e) => setSelectedTarget(e.target.value)}
                                                className="text-[11px] font-medium text-slate-300 bg-transparent outline-none cursor-pointer border-none py-1 pl-2 pr-6 focus:ring-0 w-full appearance-none z-10"
                                            >
                                                <option value="all" className="bg-slate-800">🌐 Comunicación General</option>
                                                <optgroup label="Por Rol" className="bg-slate-800 text-slate-400">
                                                    <option value="role:admin" className="bg-slate-800 text-white">👑 Solo Administradores</option>
                                                    <option value="role:cajero" className="bg-slate-800 text-white">💵 Solo Cajeros</option>
                                                    <option value="role:vendedor" className="bg-slate-800 text-white">🛒 Solo Vendedores</option>
                                                </optgroup>
                                                <optgroup label="Mensaje Privado" className="bg-slate-800 text-slate-400">
                                                    {usersList.filter(u => u.id !== user?.id).map(u => (
                                                        <option key={u.id} value={`user:${u.id}`} className="bg-slate-800 text-white">
                                                            👤 {u.name || u.username}
                                                        </option>
                                                    ))}
                                                </optgroup>
                                            </select>
                                            <div className="absolute right-1.5 pointer-events-none text-slate-400 group-hover:text-slate-300 transition-colors z-0">
                                                <ChevronDown size={12} strokeWidth={3} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                {user?.role === 'superadmin' && (
                                    <button
                                        onClick={handleClearChat}
                                        className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                        title="Vaciar Chat"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                )}
                                <button
                                    onClick={onClose}
                                    className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Messages Area */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {isLoading ? (
                                <div className="flex justify-center items-center h-full">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                                </div>
                            ) : messages.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
                                    <MessageSquare size={48} className="opacity-20" />
                                    <p>No hay mensajes todavía</p>
                                </div>
                            ) : (
                                messages.map((msg, index) => {
                                    const isMe = msg.senderId === user.id;
                                    const isZumbido = msg.content === '[ZUMBIDO_URGENTE]';
                                    const isImage = msg.type === 'image' && msg.fileUrl;
                                    const isRead = isMessageReadByOthers(msg);

                                    return (
                                        <div
                                            key={msg.id || index}
                                            className={`flex flex-col max-w-[85%] ${isMe ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                                        >
                                            <div className="flex items-center gap-2 mb-1 text-xs text-slate-400 px-1">
                                                {!isMe && <UserIcon size={12} />}
                                                <span>{isMe ? 'Tú' : msg.sender?.name || msg.sender?.username || 'Usuario'}</span>
                                                {msg.targetRole && msg.targetRole !== 'all' && (
                                                    <span className="text-blue-400 font-bold ml-1 flex items-center gap-1" title={`Enviado a: ${msg.targetRole}`}>
                                                        <Lock size={10} /> Privado
                                                    </span>
                                                )}
                                                <span className="opacity-50 ml-auto">
                                                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            {isZumbido ? (
                                                <div className={`px-4 py-2 rounded-2xl flex items-center gap-2 font-bold uppercase animate-pulse shadow-lg ${
                                                    isMe ? 'bg-red-500/20 text-red-400 rounded-tr-sm border border-red-500/50' : 'bg-red-500 text-white rounded-tl-sm'
                                                }`}>
                                                    <BellRing size={18} className="animate-bounce" /> ZUMBIDO
                                                </div>
                                            ) : (
                                                <div className={`p-1 rounded-2xl shadow-sm ${
                                                    isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-[#1E293B] text-slate-200 border border-slate-700 rounded-tl-sm'
                                                }`}>
                                                    {isImage ? (
                                                        <div className="p-1">
                                                            <img 
                                                                src={msg.fileUrl?.startsWith('http') ? msg.fileUrl : `${api.defaults.baseURL || ''}${msg.fileUrl}`} 
                                                                alt="Adjunto" 
                                                                className="rounded-xl max-w-full h-auto object-cover max-h-48"
                                                            />
                                                            {msg.content !== '📸 Imagen enviada' && (
                                                                <p className="text-sm mt-2 px-2 pb-1 whitespace-pre-wrap break-words">{msg.content}</p>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <p className="text-sm px-3 py-2 whitespace-pre-wrap break-words">{msg.content}</p>
                                                    )}
                                                </div>
                                            )}
                                            
                                            {/* Read status (only for me) */}
                                            {isMe && (
                                                <div className="mt-1 flex items-center justify-end text-[10px]">
                                                    {isRead ? (
                                                        <CheckCheck size={14} className="text-blue-400" />
                                                    ) : (
                                                        <Check size={14} className="text-slate-500" />
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}

                            {/* Typing Indicator */}
                            {typingUsersList.length > 0 && (
                                <div className="flex items-center gap-2 text-xs text-slate-400 italic mt-2 animate-pulse">
                                    <MessageSquare size={12} />
                                    {typingUsersList.join(', ')} {typingUsersList.length === 1 ? 'está' : 'están'} escribiendo...
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Area */}
                        <div className="relative p-4 border-t border-white/10 bg-black/20">
                            {/* Emoji Picker Popover */}
                            <AnimatePresence>
                                {showEmojiPicker && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                        className="absolute bottom-full left-4 mb-2 bg-slate-800 border border-white/10 rounded-2xl shadow-2xl p-3 w-64 z-50 grid grid-cols-6 gap-2"
                                    >
                                        {EMOJIS.map(emoji => (
                                            <button
                                                key={emoji}
                                                type="button"
                                                onClick={() => insertEmoji(emoji)}
                                                className="text-xl hover:bg-white/10 rounded-lg p-1 transition-colors flex items-center justify-center"
                                            >
                                                {emoji}
                                            </button>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <form onSubmit={handleSendMessage} className="relative flex items-center">
                                <div className="absolute left-2 flex items-center gap-1 z-10">
                                    <button
                                        type="button"
                                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                                        className={`p-2 rounded-lg transition-colors ${showEmojiPicker ? 'text-blue-400 bg-blue-500/10' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                                    >
                                        <Smile size={20} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors"
                                        title="Adjuntar Imagen"
                                    >
                                        <Paperclip size={18} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={sendZumbido}
                                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                        title="Enviar Zumbido (Alerta Urgente)"
                                    >
                                        <BellRing size={20} />
                                    </button>
                                </div>
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    ref={fileInputRef} 
                                    onChange={handleFileUpload} 
                                    className="hidden" 
                                />
                                <input
                                    type="text"
                                    value={newMessage}
                                    onChange={handleTyping}
                                    placeholder="Escribe un mensaje..."
                                    className="w-full bg-slate-800 border border-white/10 rounded-xl py-3 pl-[124px] pr-12 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                />
                                <button
                                    type="submit"
                                    disabled={!newMessage.trim()}
                                    className="absolute right-2 p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors"
                                >
                                    <Send size={16} />
                                </button>
                            </form>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

export default InternalChatPanel;
