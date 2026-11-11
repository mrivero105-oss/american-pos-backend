const path = require('path');

/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: 'class',
    content: [
        path.join(process.cwd(), 'public', '**', '*.{html,js}').replace(/\\/g, '/'),
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'Outfit', 'sans-serif'],
                display: ['Outfit', 'sans-serif'],
            },
            colors: {
                enterprise: {
                    50: '#fdfdfe',
                    100: '#f8fafc',
                    200: '#f1f5f9',
                    300: '#e2e8f0',
                    400: '#cbd5e1',
                    500: '#94a3b8',
                    600: '#64748b',
                    700: '#475569',
                    800: '#334155',
                    900: '#1e293b',
                    950: '#0f172a',
                },
                indigo: {
                    950: '#1e1b4b',
                },
                slate: {
                    850: '#151e32',
                    900: '#0f172a',
                    950: '#020617',
                }
            },
            animation: {
                'fade-in-up': 'fadeInUp 0.5s ease-out forwards',
                'fade-in': 'fadeIn 0.3s ease-out forwards',
                'bounce-slight': 'bounceSlight 2s infinite',
            },
            keyframes: {
                fadeInUp: {
                    '0%': { opacity: '0', transform: 'translateY(10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                bounceSlight: {
                    '0%, 100%': { transform: 'translateY(-2%)' },
                    '50%': { transform: 'translateY(0)' },
                }
            }
        }
    },
    plugins: [
        require('@tailwindcss/aspect-ratio'),
    ],
}
