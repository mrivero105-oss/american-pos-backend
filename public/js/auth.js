// Firebase Configuration
import { firebaseConfig } from './config.js';

// Initialize Firebase
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export const authService = {
    // Login with email and password
    login: async (email, password) => {
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const token = await userCredential.user.getIdToken();
            localStorage.setItem('authToken', token);
            return { success: true, user: userCredential.user };
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: error.message };
        }
    },

    // Logout
    logout: async () => {
        try {
            await signOut(auth);
            localStorage.removeItem('authToken');
            window.location.href = 'login.html';
        } catch (error) {
            console.error('Logout error:', error);
        }
    },

    // Reset Password
    resetPassword: async (email) => {
        try {
            await sendPasswordResetEmail(auth, email);
            return { success: true };
        } catch (error) {
            console.error('Reset password error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get current auth token
    getToken: async () => {
        const user = auth.currentUser;
        if (user) {
            return await user.getIdToken(true); // Force refresh
        }
        return localStorage.getItem('authToken');
    },

    // Check if user is authenticated
    isAuthenticated: () => {
        return !!auth.currentUser || !!localStorage.getItem('authToken');
    },

    // Listen to auth state changes
    onAuthChange: (callback) => {
        return onAuthStateChanged(auth, callback);
    }
};
