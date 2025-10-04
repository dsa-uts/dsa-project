import React, { useEffect, useRef, useState } from "react";
import type { FileData } from "../types/FileData";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import { ChevronDown, Download, File, FileText, Maximize2, Minimize2, X } from "lucide-react";
import { Editor } from "@monaco-editor/react";
const textExtensions = ['c', 'cpp', 'cc', 'h', 'hpp', 'py', 'js', 'jsx', 'ts', 'tsx', 'java', 'cs', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'scala', 'r', 'matlab', 'm', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'asm', 's', 'sql', 'html', 'css', 'xml', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'txt', 'md', 'markdown', 'rst', 'tex', 'log'];

const languageMap: { [key: string]: string } = {
  'c': 'c',
  'h': 'c',
  'cpp': 'cpp',
  'cc': 'cpp',
  'hpp': 'cpp',
  'py': 'python',
  'js': 'javascript',
  'jsx': 'javascript',
  'ts': 'typescript',
  'tsx': 'typescript',
  'java': 'java',
  'cs': 'csharp',
  'php': 'php',
  'rb': 'ruby',
  'go': 'go',
  'rs': 'rust',
  'swift': 'swift',
  'kt': 'kotlin',
  'scala': 'scala',
  'r': 'r',
  'matlab': 'matlab',
  'm': 'objective-c',
  'sh': 'shell',
  'bash': 'shell',
  'zsh': 'shell',
  'fish': 'shell',
  'ps1': 'powershell',
  'bat': 'bat',
  'cmd': 'bat',
  'asm': 'asm',
  's': 'asm',
  'sql': 'sql',
  'html': 'html',
  'css': 'css',
  'xml': 'xml',
  'json': 'json',
  'yaml': 'yaml',
  'yml': 'yaml',
  'toml': 'toml',
  'ini': 'ini',
  'cfg': 'ini',
  'conf': 'ini',
  'txt': 'plaintext',
  'md': 'markdown',
  'markdown': 'markdown',
  'rst': 'restructuredtext',
  'tex': 'latex',
  'log': 'log'
};

interface FileViewerProps {
  files: FileData[];
}

const FileViewer: React.FC<FileViewerProps> = ({ files }) => {
  const [selectedFile, setSelectedFile] = useState<FileData | null>(null);
  const [fileContents, setFileContents] = useState<{ [key: string]: string }>({});
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [showPdfModel, setShowPdfModel] = useState(false);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const getFileExtension = (filename: string): string => {
    const lastDot = filename.lastIndexOf(".");
    return lastDot >= 0 ? filename.substring(lastDot + 1).toLocaleLowerCase() : "";
  };
  const isTextFile = (filename: string): boolean => {
    const lowerFilename = filename.toLowerCase();
    const ext = getFileExtension(lowerFilename);
    const isMakefile = lowerFilename === "makefile";
    const isDockerfile = lowerFilename === "dockerfile";
    return textExtensions.includes(ext) || isMakefile || isDockerfile;
  }

  const getLanguage = (filename: string): string => {
    const lowerFilename = filename.toLowerCase();
    const ext = getFileExtension(lowerFilename);

    if (lowerFilename === "makefile") return "makefile";
    if (lowerFilename === "dockerfile") return "dockerfile";

    return languageMap[ext] || "plaintext";
  }

  // Filter out non-text files 
  const textFiles = files.filter(file => isTextFile(file.filename));
  const otherFiles = files.filter(file => !isTextFile(file.filename));

  // Reading text file contents, saving into fileContents state
  useEffect(() => {
    const loadTextFiles = async () => {
      const contents: { [key: string]: string } = {};

      for (const file of textFiles) {
        try {
          const text = await file.data.text();
          contents[file.filename] = text;
        } catch (error) {
          console.error(`Failed to load ${file.filename}:`, error);
          contents[file.filename] = "Failed to load file content";
        }
      }

      setFileContents(contents);
    };

    loadTextFiles();
  }, [files]);

  // Event listener for Fullscreen change of PDF modal
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    // When modal is open and not in fullscreen, close on Escape
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showPdfModel && !isFullscreen) {
        closePdfModal();
      }
    };

    // Register event listener only when modal is shown
    if (showPdfModel) {
      document.addEventListener("keydown", handleEsc);
      return () => {
        document.removeEventListener("keydown", handleEsc);
      };
    }
  }, [showPdfModel, isFullscreen]);

  // initial selected file
  useEffect(() => {
    if (textFiles.length > 0 && !selectedFile) {
      setSelectedFile(textFiles[0]);
    }
  }, [textFiles, selectedFile]);

  const downloadFile = (file: FileData) => {
    if (getFileExtension(file.filename) === 'pdf') {
      const url = URL.createObjectURL(new Blob([file.data], { type: 'application/pdf' }));
      setPdfUrl(url);
      setPdfFileName(file.filename);
      setShowPdfModel(true);
      return;
    } else {
      saveAs(file.data, file.filename);
    }
  };

  // Download all in zip
  const downloadAll = async () => {
    const zip = new JSZip();

    for (const file of files) {
      zip.file(file.filename, file.data);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'files.zip');
  }

  // Close PDF modal and revoke object URL
  const closePdfModal = () => {
    setShowPdfModel(false);
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
    }
    setPdfFileName(null);
  };

  // Toggle full screen for PDF modal
  const toggleFullscreen = async () => {
    if (!modalRef.current) return;

    try {
      if (!isFullscreen) {
        // Enter fullscreen
        const elem = modalRef.current;
        if (elem.requestFullscreen) {
          await elem.requestFullscreen();
        }
      } else {
        // Exit fullscreen
        await exitFullscreen();
      }
    } catch (error) {
      console.error("Failed to toggle fullscreen:", error);
    }
  };

  const exitFullscreen = async () => {
    try {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error("Failed to exit fullscreen:", error);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(2)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(2)} MB`;
  }

  return (
    <div className="w-full h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="flex items-center gap-4 p-4 bg-white border-b border-gray-200">
        {/* Dropdown for file selection */}
        {textFiles.length > 0 && (
          <div className="relative flex-1">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full max-w-md px-4 py-2 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-600" />
                <span className="truncate">{selectedFile?.filename || 'Select a file'}</span>
              </span>
              <ChevronDown className={`w-4 h-4 text-gray-600 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
              <div className="absolute z-10 w-full max-w-md mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {textFiles.map((file) => (
                  <button
                    key={file.filename}
                    onClick={() => {
                      setSelectedFile(file);
                      setDropdownOpen(false);
                    }}
                    className={`w-full px-4 py-2 text-left hover:bg-blue-50 flex items-center justify-between ${selectedFile?.filename === file.filename ? 'bg-blue-100' : ''
                      }`}
                  >
                    <span className="truncate">{file.filename}</span>
                    <span className="text-xs text-gray-500 ml-2">{formatFileSize(file.original_size)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Download All Button */}
        <button
          onClick={downloadAll}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center gap-2 shadow-sm"
        >
          <Download className="w-4 h-4" />
          Download All
        </button>
      </div>

      {/* Text Editor */}
      {selectedFile && fileContents[selectedFile.filename] !== undefined && (
        <div className="flex-1 border-b border-gray-200">
          <Editor
            height="500px"
            language={getLanguage(selectedFile.filename)}
            value={fileContents[selectedFile.filename]}
            theme="vs"
            options={{
              readOnly: true,
              fontSize: 14,
              lineNumbers: 'on',
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
              padding: { top: 10, bottom: 10 },
              scrollbar: {
                alwaysConsumeMouseWheel: false,
              }
            }}
          />
        </div>
      )}

      {/* Other File Types */}
      {otherFiles.length > 0 && (
        <div className="p-4 bg-white">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Other File Types</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {otherFiles.map((file) => (
              <button
                key={file.filename}
                onClick={() => downloadFile(file)}
                className="p-3 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors group"
              >
                <div className="flex flex-col items-center gap-2">
                  <File className="w-8 h-8 text-gray-500 group-hover:text-blue-600" />
                  <div className="w-full">
                    <p className="text-xs font-medium text-gray-700 truncate">{file.filename}</p>
                    <p className="text-xs text-gray-500">{formatFileSize(file.original_size)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modal for PDF viewer */}
      {showPdfModel && pdfUrl && (
        <div
          ref={modalRef}
          className={`fixed inset-0 ${isFullscreen ? 'bg-black/100' : 'bg-black/50'} flex items-center justify-center z-60 ${isFullscreen ? '' : 'p-4'}`}
        >
          <div className={`bg-white ${isFullscreen ? 'w-full h-full' : 'rounded-lg shadow-xl w-full max-w-6xl h-[90vh]'} flex flex-col`}>
            <div className="flex items-center justify-between p-4 border-b bg-gray-50">
              <div className="flex items-center gap-2">
                <File className="w-5 h-5 text-gray-600" />
                <h3 className="text-lg font-semibold text-gray-800">{pdfFileName}</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleFullscreen}
                  className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                  title={isFullscreen ? '全画面表示を終了' : '全画面表示'}
                >
                  {isFullscreen ? (
                    <Minimize2 className="w-5 h-5 text-gray-600" />
                  ) : (
                    <Maximize2 className="w-5 h-5 text-gray-600" />
                  )}
                </button>
                <button
                  onClick={() => saveAs(pdfUrl, pdfFileName || 'document.pdf')}
                  aria-label="Download PDF"
                  title="Download PDF"
                >
                  <Download className="w-5 h-5 text-gray-600" />
                </button>
                <button
                  onClick={closePdfModal}
                  className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                  aria-label="Close PDF Viewer"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>

            <div className={`flex-1 bg-gray-100 overflow-hidden`}>
              <object
                data={pdfUrl}
                type="application/pdf"
                className="w-full h-full shadow-inner"
              >
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <File className="w-16 h-16 mb-4" />
                  <p className="text-lg font-semibold mb-2">Cannot display PDF</p>
                  <p className="text-sm mb-4">Your browser does not support PDF viewing.</p>
                  <a
                    href={pdfUrl}
                    download={pdfFileName || 'document.pdf'}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </a>
                </div>
              </object>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FileViewer;
