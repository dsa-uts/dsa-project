import React, { useState, useEffect } from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import { login } from '../api/PostAPI';
import { LoginCredentials } from '../types/user';
import { useAuth } from '../context/AuthContext';
import useApiClient from '../hooks/useApiClient';
import { validateToken } from '../api/PostAPI';
import { Navigate, useNavigate } from 'react-router-dom';
import PasswordBox from '../components/PasswordBox';

const LoginPage: React.FC = () => {
    const [credentials, setCredentials] = useState<LoginCredentials>({ user_id: '', password: '' });
    const [error, setError] = useState<string>('');
    const [showPassword, setShowPassword] = useState<boolean>(false);
    const { token, setToken, setUserId, setRole } = useAuth();
    const { apiClient } = useApiClient();
    const [isTokenValid, setIsTokenValid] = useState<boolean | null>(null); // トークンの有効性を保持
    const navigate = useNavigate();

    useEffect(() => {
        const validate = async () => {
            if (token) {
                try {
                    const isValid = await apiClient({ apiFunc: validateToken });
                    setIsTokenValid(isValid);
                } catch (error) {
                    console.error('トークン検証エラー:', error);
                    setIsTokenValid(false); // 検証に失敗した場合は無効とする
                }
            } else {
                setIsTokenValid(false); // トークンがない場合は無効とする
            }
        };
        validate();
    }, [token]);


    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target
        // 入力時に記録されているユーザIDとパスワードを更新
        // name: user_idまたはpassword
        // value: 入力された値
        setCredentials({ ...credentials, [name]: value });
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        try {
            const result = await login(credentials);
            setError('');
            setToken(result.access_token); 
            setUserId(result.user_id);
            setRole(result.role);
            const redirectUrl = sessionStorage.getItem("redirectUrl");

            // リダイレクトURLがあればそのページへ、なければホームへ
            if (redirectUrl) {
                navigate(redirectUrl);
                sessionStorage.removeItem("redirectUrl"); // 使用後は削除
            } else {
                navigate("/");
            }
        } catch (error) {
            console.error('Login failed:', error);
            setError(`ログインに失敗しました。: ${(error as any).response.data.detail}`);
        }
    };

    if (isTokenValid) {
        // トークンが有効な場合、ホームページへリダイレクト
        return <Navigate to="/" />;
    }

    // トークンの検証中は何も表示しない
    if (isTokenValid === null) {
        return null; // ローディング中やスピナーを表示しても良い
    }

    return (
        <>
            <GlobalStyle /> {/* ログイン画面用のグローバルスタイルを適用 */}
            <PageContainer>
                <FormContainer onSubmit={handleSubmit}>
                    <h1>ログイン</h1>
                    {error && <ErrorMessage>{error}</ErrorMessage>}
                    <FormGroup>
                        <Label htmlFor="user_id">学籍番号（例: 202312345）:</Label>
                        <Input
                            type="text"
                            id="username"
                            name="user_id"
                            value={credentials.user_id}
                            onChange={handleChange}
                            autoComplete="username"
                            required
                        />
                    </FormGroup>
                    <FormGroup>
                        <Label htmlFor="password">パスワード:</Label>
                        <PasswordBox value={credentials.password} onChange={handleChange} />
                    </FormGroup>
                    <Button type="submit">ログイン</Button>
                </FormContainer>
            </PageContainer>
        </>
    );
};

export default LoginPage;

const GlobalStyle = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    }

    .app {
        display: block; /* ログイン画面ではフレックスを解除 */
        height: auto;
    .content {
        margin: 0; /* ログイン画面ではmarginをリセット */
        padding: 0;
        width: 100%; /* ログイン画面で幅を100%にする */
    }
`;


const PageContainer = styled.div`
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    background-color: #f5f5f5;
    padding: 0 20px; /* 左右に均等な余白を持たせる */
`;


const FormContainer = styled.form`
    background-color: white;
    padding: 2rem;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    width: 300px;
`;

const FormGroup = styled.div`
    margin-bottom: 1rem;
`;

const Label = styled.label`
    display: block;
    margin-bottom: 0.5rem;
    font-weight: bold;
`;

const Input = styled.input`
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
`;

const Button = styled.button`
    width: 100%;
    padding: 0.75rem;
    background-color: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;

    &:hover {
        background-color: #0056b3;
    }
`;

const ErrorMessage = styled.p`
    color: red;
    margin-bottom: 1rem;
`;
