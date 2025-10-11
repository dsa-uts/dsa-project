import React, { useState, type ChangeEvent, type FormEvent } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";
import { useAuth, type LoginCredentials } from "../auth/hooks";

// url: /login
const LoginPage: React.FC = () => {
  const [credentials, setCredentials] = useState<LoginCredentials>({ username: '', password: '' });
  const location = useLocation();

  // Read redirect query parameter
  const [searchParams] = useSearchParams();
  const redirectParam = searchParams.get('redirect');
  // console.log("Redirect parameter:", redirectParam);

  let decodedRedirectParam: string | null = null;
  if (redirectParam) {
    try {
      decodedRedirectParam = decodeURIComponent(redirectParam);
      // console.log("Decoded redirect parameter:", decodedRedirectParam);
    } catch (e) {
      console.error("Failed to decode redirect parameter:", e);
    }
  }

  // console.log("Location state:", location.state);
  // console.log("Location state from:", location.state?.from);
  // console.log("Location state from pathname:", location.state?.from?.pathname);

  const from = location.state?.from?.pathname || decodedRedirectParam || "/about";

  const { login: loginMutation, loginResponse, isLoginPending, loginError, isAuthenticated } = useAuth();

  const handleSubmit = (e: FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    if (credentials.username.trim().length === 0 || credentials.password.trim().length === 0) {
      alert('ユーザーIDとパスワードを入力してください');
      return;
    }

    loginMutation(credentials);
  }

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const { name, value } = e.target;
    setCredentials(prev => ({ ...prev, [name]: value }));
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit(e as any);
    }
  }

  // When login is successful, loginResponse is materialized, then navigate to /dashboard
  if (!!loginResponse || isAuthenticated()) {
    return <Navigate to={from} replace />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="bg-white rounded-2xl shadow-xl border outline-none p-8">
          <div className="textcenter mb-8">
            <h2 className="text-3xl font-bold text-gray-900">ログイン</h2>
            <p className="mt-2 text-sm text-gray-600">アカウントにログインしてください</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                ユーザーID
              </label>

              <input
                id="username"
                name="username"
                type="text"
                required
                value={credentials.username}
                onChange={handleInputChange}
                placeholder="ユーザーIDを入力してください"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition duration-200"
                autoComplete="username"
                disabled={isLoginPending}
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                パスワード
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                value={credentials.password}
                onChange={handleInputChange}
                placeholder="パスワードを入力してください"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparen outline-none transition duration-200"
                autoComplete="current-password"
                onKeyDown={handleKeyDown}
                disabled={isLoginPending}
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 px-4 bg-red-50 border border-red-200 rounded-lg"
              disabled={isLoginPending}
              onClick={handleSubmit}
            >
              {isLoginPending ? "ログイン中..." : "ログイン"}
            </button>
          </form>

          {loginError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">
                {loginError?.message || "ログインに失敗しました。"}
              </p>
            </div>
          )}
        </div>

        <div className="text-center">
          <p className="text-sm text-gray-600">トークンの有効時間: 2時間</p>
        </div>
      </div>
    </div>
  )
}

export default LoginPage;