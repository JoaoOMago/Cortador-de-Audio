/**
 * Toast notification system.
 * Extracted to its own module to avoid circular dependencies.
 */

const toastContainer = document.getElementById('toast-container');

/**
 * Displays a toast notification.
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {number} durationMs
 */
export function showToast(message, type = 'info', durationMs = 3500) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon =
    type === 'success' ? '✓' :
    type === 'warning' ? '⚠' :
    type === 'error' ? '✕' : 'ℹ';

  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(30px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 250);
  }, durationMs);
}
