export const playSendSound = () => {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
        
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.05);
        gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
        
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
    } catch (_e) {
        console.warn('AudioContext no soportado o bloqueado');
    }
};

export const playReceiveSound = () => {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.setValueAtTime(1000, ctx.currentTime + 0.1);
        
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
        gainNode.gain.setValueAtTime(0.2, ctx.currentTime + 0.1);
        gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
        
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
    } catch (_e) {
        console.warn('AudioContext no soportado o bloqueado');
    }
};

export const playUrgentSound = () => {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Crear un sonido repetitivo tipo alarma
        for (let i = 0; i < 3; i++) {
            const osc = ctx.createOscillator();
            const gainNode = ctx.createGain();
            osc.connect(gainNode);
            gainNode.connect(ctx.destination);
            
            osc.type = 'square';
            const startTime = ctx.currentTime + (i * 0.2);
            osc.frequency.setValueAtTime(1000, startTime);
            osc.frequency.linearRampToValueAtTime(1500, startTime + 0.1);
            
            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
            gainNode.gain.linearRampToValueAtTime(0, startTime + 0.15);
            
            osc.start(startTime);
            osc.stop(startTime + 0.15);
        }
    } catch (_e) {
        console.warn('AudioContext no soportado o bloqueado');
    }
};
