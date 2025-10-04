import React, { useState, useEffect } from 'react';
import { FileRecord } from '../types/Assignments';
import styled from 'styled-components';

// メモリ上にあるファイルをダウンロードまたはプレビューするボタン
const OfflineFileDownloadButton: React.FC<{ file: FileRecord }> = ({ file }) => {
    const [isDialogOpen, setDialogOpen] = useState(false);
    const [fileURL, setFileURL] = useState<string | null>(null);

    useEffect(() => {
        // BlobにMIMEタイプを指定
        const pdfBlob = new Blob([file.content], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(pdfBlob);
        setFileURL(url);

        // コンポーネントのアンマウント時にURLを解放
        return () => {
            window.URL.revokeObjectURL(url);
        };
    }, [file.content]);

    const handleOpenDialog = () => {
        setDialogOpen(true);
    };

    const handleCloseDialog = () => {
        setDialogOpen(false);
    };

    // PDFがBlob形式であることを確認
    if (typeof file.content === 'string') {
        console.log("file.content is string");
        return <div>error: file.content is string</div>;
    }

    return (
        <>
            {/* PDFプレビューを開くボタン */}
            <LinkButton onClick={handleOpenDialog}>{file.name}</LinkButton>

            {/* モーダルダイアログ */}
            {isDialogOpen && fileURL && (
                <div 
                    style={{
                        position: 'fixed',
                        top: 0, left: 0, width: '100%', height: '100%',
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        display: 'flex', justifyContent: 'center', alignItems: 'center',
                        zIndex: 1000,
                    }}
                    onClick={handleCloseDialog}
                >
                    <div style={{
                        backgroundColor: '#fff', padding: '10px', borderRadius: '8px', maxWidth: '90%', maxHeight: '90%',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'auto'
                    }}>
                        <iframe
                            src={fileURL}
                            title="PDF Preview"
                            style={{ width: '80vw', height: '80vh', border: 'none' }}
                        />
                    </div>
                </div>
            )}
        </>
    );
};

export default OfflineFileDownloadButton;

const LinkButton = styled.a`
    color: #0000EE;
    text-decoration: none;
    cursor: pointer;
    &:hover {
        text-decoration: underline;
    }
`
