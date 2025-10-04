import React, { useState, useRef, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
    Box,
    Paper,
    Typography,
    Button,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    IconButton
} from '@mui/material';
import { CloudUpload, InsertDriveFile, Delete } from '@mui/icons-material';

interface FileUploadFormProps {
    onSubmit: (files: File[]) => void;
    descriptionOnBox: string;
    isSubmitting?: boolean;
}

const FileUploadBox: React.FC<FileUploadFormProps> = ({ onSubmit, descriptionOnBox, isSubmitting }) => {
    const [files, setFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [inputKey, setInputKey] = useState(Date.now());

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (!isSubmitting) {
            setFiles(prevFiles => [...prevFiles, ...acceptedFiles]);
        }
    }, [isSubmitting]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, disabled: isSubmitting });

    const handleRemoveFile = (index: number) => {
        setFiles(prevFiles => prevFiles.filter((_, i) => i !== index));
        setInputKey(Date.now()); // ファイル削除時にinputのKeyを更新
    };

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        onSubmit(files);
    }

    const handleAddFile = () => {
        fileInputRef.current?.click();
    }

    const handleBoxClick = () =>{
        if (!isSubmitting) {
            fileInputRef.current?.click();
        }
    };

    return (
        <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto', p: 2 }}>
            <Paper
                {...getRootProps()}
                onClick={handleBoxClick}
                sx={{
                    p: 3,
                    border: '2px dashed',
                    borderColor: isSubmitting
                        ? 'grey.300'
                        : isDragActive
                            ? 'primary.main'
                            : 'grey.300',
                    bgcolor: isSubmitting
                        ? 'grey.100' 
                        : isDragActive
                            ? 'primary.50'
                            : 'background.paper',
                    cursor: isSubmitting ? 'not-allowed' :'pointer',
                    transition: 'all 0.2s ease-in-out',
                    '&:hover': { // ホバー時のスタイル
                        bgcolor: isSubmitting ? 'grey.100' : 'primary.50',
                        borderColor: isSubmitting ? 'grey.300' : 'primary.main'
                    }
                }}
            >
                <input {...getInputProps()} ref={fileInputRef} key={inputKey}/>
                <Box sx={{ textAlign: 'center' }}>
                    <CloudUpload sx={{ fontSize: 48, color: 'primary.main', mb: 2}} />
                    <Typography variant="h6" gutterBottom>
                        {descriptionOnBox}
                    </Typography>
                </Box>

                {files.length > 0 && (
                    <List>
                        {files.map((file, index) => (
                            <ListItem key={index}
                                secondaryAction={
                                    <IconButton 
                                        edge="end"
                                        onClick={() => handleRemoveFile(index)}
                                        size="small"
                                        sx={{ ml: 'auto' }}
                                    >
                                        <Delete />
                                    </IconButton>
                                }
                            >
                                <ListItemIcon>
                                    <InsertDriveFile />
                                </ListItemIcon>
                                <ListItemText primary={file.name} />
                            </ListItem>
                        ))}
                    </List>
                )}
            </Paper>

            <Box sx={{ mt: 2, display: 'flex', gap: 2, justifyContent: 'center' }}>
                <Button
                    variant="outlined"
                    onClick={handleAddFile}
                    startIcon={<CloudUpload />}
                >
                    ファイルを追加
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={files.length === 0 || isSubmitting}
                >
                    {isSubmitting ? '提出中...' : '提出'}
                </Button>
            </Box>
        </Box>
    );
};

export default FileUploadBox;
