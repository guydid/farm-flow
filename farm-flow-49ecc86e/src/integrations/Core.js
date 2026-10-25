import { getToken } from '@/api/localClient';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export async function UploadFile({ file }) {
  const formData = new FormData();
  formData.append('file', file);
  // /api/upload דורש התחברות — הטוקן בכותרת (FormData: בלי Content-Type ידני)
  const token = getToken();
  const res = await fetch(`${API_URL}/upload`, { method: 'POST', body: formData, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `העלאה נכשלה (${res.status})`);
  return data;
}

export async function UploadPrivateFile({ file }) {
  return UploadFile({ file });
}

export async function CreateFileSignedUrl({ file_path }) {
  return { url: file_path };
}

export async function InvokeLLM() {
  return { content: '' };
}

export async function SendEmail() {
  return { success: true };
}

export async function SendSMS() {
  return { success: true };
}

export async function GenerateImage() {
  return { url: '' };
}

export async function ExtractDataFromUploadedFile() {
  return {};
}
