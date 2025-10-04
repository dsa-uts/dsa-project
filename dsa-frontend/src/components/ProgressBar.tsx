import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { ProgressMessage } from '../types/Assignments';

interface ProgressBarProps {
    progress: ProgressMessage;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ progress }) => {
    const isError = progress.status === "error" || progress.progress_percentage < 0;
    return (
        <div aria-valuenow={progress.progress_percentage} aria-valuemin={0} aria-valuemax={100} role="progressbar" style={{ display: 'block' }}>
            <ProgressMessageText isError={isError}>{progress.message}</ProgressMessageText>
            <ProgressBarContainer>
                <Progress progress_percentage={progress.progress_percentage} isError={isError}>
                    {progress.progress_percentage}%
                </Progress>
            </ProgressBarContainer>
        </div>
    );
};

export default ProgressBar;

const ProgressMessageText = styled.div<{ isError?: boolean }>`
    color: ${props => props.isError ? 'red' : 'black'};
    padding: 5px;
`;

const ProgressBarContainer = styled.div`
    width: 100%;
    background-color: #ddd;
    border: 1px solid #bbb;
`;

const Progress = styled.div<{ progress_percentage: number; isError?: boolean }>`
    width: ${props => props.progress_percentage}%;
    background-color: ${props => props.isError ? 'red' : '#5AFF19'};
    text-align: center;
    color: black;
    padding: 5px 0;
    transition: width 0.5s ease-in-out;
`;
