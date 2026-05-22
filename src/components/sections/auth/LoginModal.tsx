import React, { useState, useEffect } from 'react';
import { Check, Eye, EyeOff } from 'lucide-react';
import { useLogin } from '@/hooks/home-landing/useLogin';
import { Notify } from '@/lib/Notify';

interface LoginModalProps {
    onClose: () => void;
}

const LoginModal: React.FC<LoginModalProps> = ({ onClose }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [computerId, setComputerId] = useState('');
    const [showSuccessToast, setShowSuccessToast] = useState(false);

    const { handleLogin, loading } = useLogin();

    useEffect(() => {
        // Hydrate from localStorage safely
        if (typeof window !== 'undefined') {
            setUsername(localStorage.getItem('username') || '');
            setPassword(localStorage.getItem('saved_password') || '');
        }
    }, []);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const isAdminLogin = username === 'admin' && password === 'admin@123';

        if (!username || !password || (!computerId && !isAdminLogin)) {
            Notify({
                title: "Lỗi đăng nhập",
                description: "Vui lòng nhập đầy đủ thông tin liên kết.",
                status: "warning"
            });
            return;
        }

        try {
            await handleLogin({ username, password, computerId });
            setShowSuccessToast(true);
            setTimeout(() => {
                onClose();
            }, 1500);
        } catch (err: any) {
            console.error('Login error', err);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
            {/* Success Toast */}
            <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] transition-all duration-300 transform ${showSuccessToast ? 'translate-y-0 opacity-100 scale-100' : '-translate-y-4 opacity-0 scale-95 hidden'}`}>
                <div className="bg-green-500/90 backdrop-blur-sm text-white px-5 py-3 rounded-lg shadow-lg border border-green-400/30 flex items-center space-x-3">
                    <div className="bg-white/20 rounded-full p-1 shrink-0">
                        <Check size={16} className="text-white" />
                    </div>
                    <span className="font-medium">Đăng nhập thành công</span>
                </div>
            </div>

            <div className="bg-[#111] border border-[#333] w-full max-w-md rounded-2xl p-8 relative shadow-2xl shadow-red-500/10">
                {/* Close Button */}
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
                >
                    ✕
                </button>

                {/* Header */}
                <div className="flex flex-col items-center justify-center mb-8">
                    <div className="w-16 h-16 bg-gradient-to-tr from-red-600 to-orange-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-red-500/20">
                        <span className="text-3xl text-white font-black mix-blend-overlay">H</span>
                    </div>
                    <h2 className="text-2xl font-black text-white text-center tracking-tighter uppercase">Định Danh Thiết Bị</h2>
                    <p className="text-sm text-gray-400 mt-2 text-center">Bản quyền phần mềm Harumi AI</p>
                </div>

                <form onSubmit={onSubmit} className="space-y-5">

                    <div>
                        <label className="block text-xs font-bold text-gray-400 mb-1.5 uppercase tracking-widest pl-1">Username / Tài khoản</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Nhập tên đăng nhập"
                            className="w-full bg-[#1a1a1a] border border-[#333] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all font-medium"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-400 mb-1.5 uppercase tracking-widest pl-1">Mật khẩu</label>
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full bg-[#1a1a1a] border border-[#333] rounded-xl px-4 py-3 pr-12 text-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all font-medium"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors"
                            >
                                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-400 mb-1.5 uppercase tracking-widest pl-1">Mã thiết bị / Computer ID</label>
                        <input
                            type="text"
                            value={computerId}
                            onChange={(e) => setComputerId(e.target.value)}
                            placeholder="Nhập System ID của máy này..."
                            className="w-full bg-blue-900/10 border border-blue-900/40 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-bold placeholder:text-white/50 uppercase tracking-widest text-sm"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className={`w-full font-black text-white rounded-xl mt-4 px-4 py-4 uppercase tracking-widest text-sm transition-all flex justify-center items-center gap-2 ${loading ? 'bg-red-600/50 cursor-not-allowed' : 'bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600 shadow-lg shadow-red-900/25'}`}
                    >
                        {loading ? (
                            <>
                                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Đang xác thực...
                            </>
                        ) : (
                            'Đăng Nhập'
                        )}
                    </button>

                </form>

                <div className="mt-8 pt-6 border-t border-[#222] text-center">
                    <p className="text-xs text-gray-500">Mọi hành vi đăng nhập trái phép sẽ bị theo dõi thiết bị ID tự động.</p>
                </div>
            </div>
        </div>
    );
};

export default LoginModal;
