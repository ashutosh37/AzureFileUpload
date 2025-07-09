import type { ReactElement } from 'react';
import { FileIcon, WordIcon, ExcelIcon, PdfIcon, ImageIcon, EmailIcon } from '../icons';

export const formatDate = (dateString?: string): string => {
  if (!dateString) return 'N/A';
  try {
    return new Date(dateString).toLocaleString();
  } catch (e) {
    return dateString; // Return original string if parsing fails
  }
};

export const getFileIcon = (fileName: string): ReactElement => {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  if (!extension) return <FileIcon />;

  switch (extension) {
    case 'doc':
    case 'docx':
      return <WordIcon />;
    case 'xls':
    case 'xlsx':
      return <ExcelIcon />;
    case 'pdf':
      return <PdfIcon />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'bmp':
    case 'svg':
      return <ImageIcon />;
    case 'eml':
    case 'msg':
      return <EmailIcon />;
    default:
      return <FileIcon />;
  }
};