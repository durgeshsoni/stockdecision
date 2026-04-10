// ===== Firebase Authentication =====

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAmBd6Kgiu3R9SHj5ICVoMVjgV-PSCqFMA",
    authDomain: "stockanalyzer-b1c7c.firebaseapp.com",
    projectId: "stockanalyzer-b1c7c",
    storageBucket: "stockanalyzer-b1c7c.firebasestorage.app",
    messagingSenderId: "640971298555",
    appId: "1:640971298555:web:aa9970f74fe207edfac25e",
};

// Initialize Firebase
firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();

let confirmationResult = null;

// ===== Auth Functions =====

async function loginWithGoogle() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);
        // Close modal and update UI immediately - don't wait for backend sync
        closeLoginModal();
        updateAuthUI(result.user);
        showToast('Logged in successfully!', 'success');
        // Sync to backend in background (non-blocking)
        syncUserToBackend(result.user).catch(err => console.warn('Backend sync:', err.message));
    } catch (err) {
        console.error('Google login error:', err);
        if (err.code === 'auth/popup-closed-by-user') return;
        showToast(err.message || 'Login failed', 'error');
    }
}

async function sendOTP() {
    const phoneInput = document.getElementById('phoneInput');
    const phone = phoneInput ? phoneInput.value.trim() : '';
    if (!phone || phone.length !== 10) {
        showToast('Enter a valid 10-digit mobile number', 'error');
        return;
    }
    const fullPhone = '+91' + phone;
    const sendBtn = document.getElementById('sendOtpBtn');
    try {
        if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending...'; }

        // Always reset reCAPTCHA for a fresh verifier each attempt
        if (window.recaptchaVerifier) {
            try { window.recaptchaVerifier.clear(); } catch (_) {}
            window.recaptchaVerifier = null;
        }
        // Clear the container DOM to avoid stale widgets
        const container = document.getElementById('recaptcha-container');
        if (container) container.innerHTML = '';

        window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
            size: 'invisible',
            callback: () => {},
            'expired-callback': () => {
                window.recaptchaVerifier = null;
            }
        });
        await window.recaptchaVerifier.render();

        confirmationResult = await auth.signInWithPhoneNumber(fullPhone, window.recaptchaVerifier);
        const otpSection = document.getElementById('otpSection');
        if (otpSection) otpSection.classList.remove('hidden');
        if (sendBtn) { sendBtn.textContent = 'OTP Sent'; }
        showToast('OTP sent to ' + fullPhone, 'success');
    } catch (err) {
        console.error('OTP send error:', err);
        // Provide user-friendly error messages
        let msg = 'Failed to send OTP. ';
        if (err.code === 'auth/invalid-phone-number') msg = 'Invalid phone number. Check and try again.';
        else if (err.code === 'auth/too-many-requests') msg = 'Too many attempts. Try again later.';
        else if (err.code === 'auth/captcha-check-failed') msg = 'reCAPTCHA failed. Refresh the page and try again.';
        else if (err.code === 'auth/quota-exceeded') msg = 'SMS quota exceeded. Try Google login instead.';
        else msg += err.message || 'Try again.';
        showToast(msg, 'error');
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send OTP'; }
        // Reset recaptcha on error
        if (window.recaptchaVerifier) {
            try { window.recaptchaVerifier.clear(); } catch (_) {}
            window.recaptchaVerifier = null;
        }
    }
}

async function verifyOTP() {
    const otpInput = document.getElementById('otpInput');
    const code = otpInput ? otpInput.value.trim() : '';
    if (!code || code.length !== 6) {
        showToast('Enter a valid 6-digit OTP', 'error');
        return;
    }
    if (!confirmationResult) {
        showToast('Please send OTP first', 'error');
        return;
    }
    try {
        const result = await confirmationResult.confirm(code);
        // Close modal and update UI immediately
        closeLoginModal();
        updateAuthUI(result.user);
        showToast('Phone verified successfully!', 'success');
        // Sync to backend in background
        syncUserToBackend(result.user).catch(err => console.warn('Backend sync:', err.message));
    } catch (err) {
        console.error('OTP verify error:', err);
        let msg = 'Invalid OTP. ';
        if (err.code === 'auth/invalid-verification-code') msg = 'Wrong OTP. Check and try again.';
        else if (err.code === 'auth/code-expired') msg = 'OTP expired. Request a new one.';
        else msg += err.message || 'Try again.';
        showToast(msg, 'error');
    }
}

async function logout() {
    try {
        await auth.signOut();
        updateAuthUI(null);
        hideDashboard();
        showToast('Logged out', 'success');
    } catch (err) {
        console.error('Logout error:', err);
    }
}

async function getAuthToken() {
    const user = auth.currentUser;
    if (!user) return null;
    try {
        return await user.getIdToken();
    } catch (err) {
        console.error('Token error:', err);
        return null;
    }
}

function getCurrentUser() {
    const user = auth.currentUser;
    if (!user) return null;
    return {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL
    };
}

function onAuthChange(callback) {
    auth.onAuthStateChanged(callback);
}

// ===== Backend Sync =====

async function syncUserToBackend(user) {
    try {
        const token = await user.getIdToken();
        await fetch('/api/auth?action=login', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            }
        });
    } catch (err) {
        console.error('Backend sync error:', err);
    }
}

// ===== UI Updates =====

function updateAuthUI(user) {
    const loginBtn = document.getElementById('loginBtn');
    const userMenu = document.getElementById('userMenu');
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');

    if (user) {
        if (loginBtn) loginBtn.classList.add('hidden');
        if (userMenu) userMenu.classList.remove('hidden');
        if (userAvatar) {
            userAvatar.src = user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.displayName || user.email || 'U') + '&background=3b82f6&color=fff&size=64';
        }
        if (userName) userName.textContent = user.displayName || user.email || 'User';
    } else {
        if (loginBtn) loginBtn.classList.remove('hidden');
        if (userMenu) userMenu.classList.add('hidden');
    }
}

function showLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) modal.classList.remove('hidden');
    // Reset form state
    const otpSection = document.getElementById('otpSection');
    if (otpSection) otpSection.classList.add('hidden');
    const sendBtn = document.getElementById('sendOtpBtn');
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send OTP'; }
    const phoneInput = document.getElementById('phoneInput');
    if (phoneInput) phoneInput.value = '';
    const otpInput = document.getElementById('otpInput');
    if (otpInput) otpInput.value = '';
}

function closeLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) modal.classList.add('hidden');
}

function showToast(message, type) {
    // Use existing toast if available, else create simple one
    if (typeof window.showToastOriginal === 'function') {
        window.showToastOriginal(message, type);
        return;
    }
    const toast = document.createElement('div');
    toast.className = 'auth-toast auth-toast-' + (type || 'info');
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:8px;font-size:14px;z-index:10000;animation:fadeIn 0.3s ease;color:#fff;background:' + (type === 'error' ? 'var(--accent-red)' : type === 'success' ? 'var(--accent-green)' : 'var(--accent-blue)');
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ===== Auth State Listener =====

onAuthChange((user) => {
    updateAuthUI(user);
});

// ===== User Dropdown Toggle =====

document.addEventListener('DOMContentLoaded', () => {
    const userMenu = document.getElementById('userMenu');
    if (userMenu) {
        userMenu.addEventListener('click', (e) => {
            const dropdown = document.getElementById('userDropdown');
            if (dropdown) dropdown.classList.toggle('show');
        });
    }
    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        const userMenu = document.getElementById('userMenu');
        const dropdown = document.getElementById('userDropdown');
        if (dropdown && userMenu && !userMenu.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });
});
