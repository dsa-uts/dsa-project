import React, { useState } from 'react';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css"
import { createUser } from '../api/PostAPI';
import { CreateUser } from '../types/user';
import { useAuth } from '../context/AuthContext';
import StudentListUploadBox from '../components/StudentListUploadBox';
import useApiClient from '../hooks/useApiClient';
import { UserRole } from '../types/token';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import PasswordBox from '../components/PasswordBox';
import ButtonComponent from '../components/ButtonComponent';

const RegisterPage: React.FC = () => {
    const navigate = useNavigate();
    const [user_id, setUserId] = useState('');
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<UserRole>(UserRole.student);
    const [confirmPassword, setConfirmPassword] = useState('');
    const [disabled, setDisabled] = useState(false);
    const [activeStartDate, setActiveStartDate] = useState<Date | null>(new Date(2024, 10, 1, 9, 0, 0));
    const [activeEndDate, setActiveEndDate] = useState<Date | null>(new Date(2025, 3, 1, 23, 59, 59));
    const { apiClient } = useApiClient();
    const { user_id: login_user_id, role: login_user_role, logout } = useAuth(); // useAuthから現在のユーザー情報も取得する
    const [error, setError] = useState('');

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!email.includes('@')) {
            setError('メールアドレスの形式が正しくありません。');
            return;
        }

        if (!email.endsWith('tsukuba.ac.jp')) {
            setError('tsukuba.ac.jpで終わるメールアドレスを入力してください。');
            return;
        }

        if (password !== confirmPassword) {
            setError('パスワードが一致しません。');
            return;
        }

        if (activeStartDate && activeEndDate && new Date(activeStartDate) > new Date(activeEndDate)) {
            setError('有効開始日時は有効終了日時より前でなければなりません。');
            return;
        }

        const newUser: CreateUser = {
            user_id: user_id,
            username: username,
            email: email,
            plain_password: password,
            role: role,
            disabled: disabled,
            active_start_date: activeStartDate || null,
            active_end_date: activeEndDate || null,
        };

        try {
            await apiClient({apiFunc: createUser, args: [newUser]});
            alert('アカウントが正常に作成されました。');
            setUsername('');
            setEmail('');
            setPassword('');
            setConfirmPassword('');
            setRole(UserRole.student);
            setDisabled(false);
            setActiveStartDate(new Date(2024, 10, 1, 9, 0, 0));
            setActiveEndDate(new Date(2025, 3, 1, 23, 59, 59));
            setError('');
            navigate('/users/management');
        } catch (error) {
            console.error('アカウントの作成に失敗しました。', error);
            setError(`アカウントの作成に失敗しました: ${(error as any).response.data.detail}`);
        }
    };

    if (login_user_id === null) {
        logout();
    }
    if (login_user_role === UserRole.student) {
        return <p>管理者権限がありません。</p>;
    }

    return (
        <div>
            <h1>アカウント登録</h1>
            {error && <p style={{ color: 'red' }}>{error}</p>}
            <form onSubmit={handleRegister} style={{ marginBottom: '20px' }}>
                <UserItemContainer>
                    <UserItem>ユーザーID:</UserItem>
                    <InputWrapper>
                        <StyledInput type="text" value={user_id} onChange={(e) => setUserId(e.target.value)} required />
                    </InputWrapper>
                </UserItemContainer>
                <UserItemContainer>
                    <UserItem>ユーザー名:</UserItem>
                    <InputWrapper>
                        <StyledInput type="text" value={username} onChange={(e) => {setUsername(e.target.value)}} required />
                    </InputWrapper>
                </UserItemContainer>
                <UserItemContainer>
                    <UserItem>メールアドレス:</UserItem>
                    <InputWrapper>
                        <StyledInput type="email" value={email} onChange={(e) => {setEmail(e.target.value)}} required />
                    </InputWrapper>
                </UserItemContainer>
                <UserItemContainer>
                    <UserItem>パスワード:</UserItem>
                    <PasswordBox value={password} onChange={(e) => {setPassword(e.target.value)}} style={{ width: '300px' }} required />
                </UserItemContainer>
                <UserItemContainer>
                    <UserItem>パスワード確認:</UserItem>
                    <PasswordBox value={confirmPassword} onChange={(e) => {setConfirmPassword(e.target.value)}} style={{width: '300px'}} required />
                </UserItemContainer>
                <UserItemContainer>
                    <UserItem>役職:</UserItem>
                    <div style={{ fontSize: '20px', fontWeight: 'normal' }}><input type="radio" name="role" value="student" checked={role === UserRole.student} onChange={() => setRole(UserRole.student)} /> 学生</div>
                    <div style={{ fontSize: '20px', fontWeight: 'normal' }}><input type="radio" name="role" value="manager" checked={role === UserRole.manager} onChange={() => setRole(UserRole.manager)} /> 採点者</div>
                </UserItemContainer>
                <UserItemContainer>
                    <UserItem>有効開始日時:</UserItem>
                    <UserItem>
                        <DatePicker 
                            selected={activeStartDate}
                            onChange={(date: Date | null) => {setActiveStartDate(date)}}
                            showTimeSelect
                            dateFormat="yyyy/MM/dd HH:mm"
                        />
                    </UserItem>
                    <small>指定しない場合は無期限として扱われます．</small>
                </UserItemContainer>
                <UserItemContainer>
                    <UserItem>有効終了日時:</UserItem>
                    <UserItem>
                        <DatePicker 
                            selected={activeEndDate}
                            onChange={(date: Date | null) => {setActiveEndDate(date)}}
                            showTimeSelect
                            dateFormat="yyyy/MM/dd HH:mm"
                        />
                    </UserItem>
                    <small>指定しない場合は無期限として扱われます．</small>
                </UserItemContainer>
                <ButtonContainer>
                    <ButtonComponent onClick={() => navigate("/users/management")} label="キャンセル" height='40px' width='120px' />
                    <ButtonComponent type='submit' label="登録" height='40px' width='120px' disabled={error !== ''}/>
                </ButtonContainer>
            </form>
            <StudentListUploadBox />
        </div>
    );
};

export default RegisterPage;

const ButtonContainer = styled.div`
    display: flex;
    justify-content: flex-start;
    margin-top: 20px;
    gap: 80px;
    padding-left: 130px; // UserItemの幅と同じ
`

const UserItemContainer = styled.div`
    display: flex;
    justify-content: flex-start;
    margin-top: 20px;
    gap: 20px;
    flex-direction: row;
    align-items: center;
`

const UserItem = styled.div`
    font-size: 20px;
    font-family: Inter;
    font-weight: 700;
    word-wrap: break-word;
    width: 150px; // 固定幅を設定
    text-align: right; // テキストを右寄せに
`

const InputWrapper = styled.div`
    flex: 1;
    display: flex
    align-items: center;
    position: relative;
`;

const StyledInput = styled.input`
    width: 300px;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
`;

