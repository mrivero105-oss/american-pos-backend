export const ui = {
    showNotification: (message, type = 'success') => {
        const container = document.getElementById('notification-container');
        if (!container) {
            const newContainer = document.createElement('div');
            newContainer.id = 'notification-container';
            newContainer.className = 'fixed top-4 right-4 z-50 flex flex-col gap-2';
            document.body.appendChild(newContainer);
        }

        const notification = document.createElement('div');
        const bgColor = type === 'error' ? 'bg-red-500' : 'bg-green-500';
        notification.className = `${bgColor} text-white px-6 py-3 rounded-lg shadow-lg transform transition-all duration-300 translate-x-full`;
        notification.textContent = message;

        document.getElementById('notification-container').appendChild(notification);

        // Animate in
        requestAnimationFrame(() => {
            notification.classList.remove('translate-x-full');
        });

        // Remove after 3 seconds
        setTimeout(() => {
            notification.classList.add('translate-x-full');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
    },

    toggleModal: (modalId, show = true) => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = show ? 'block' : 'none';
        }
    }
};
