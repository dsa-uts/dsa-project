import { useState, CSSProperties } from "react";
import styled from "styled-components";

interface PasswordBoxProps {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    required?: boolean;
    style?: CSSProperties;
}

const PasswordBox: React.FC<PasswordBoxProps> = ({ value, onChange, required = true, style }) => {
    const [showPassword, setShowPassword] = useState<boolean>(false);

    return (
        <PasswordContainer>
            <Input
                type={showPassword ? 'text' : 'password'}
                value={value}
                name="password"
                onChange={onChange}
                autoComplete="current-password"
                required={required}
                style={style}
            />
            <ShowPasswordButton type="button" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? '非表示' : '表示'}
            </ShowPasswordButton>
        </PasswordContainer>
    );
};

export default PasswordBox;

const Input = styled.input`
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
`;


const PasswordContainer = styled.div`
    position: relative;
`;

const ShowPasswordButton = styled.button`
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    background-color: transparent;
    border: none;
    cursor: pointer;
    color: #007bff;
    type: button;
`;
