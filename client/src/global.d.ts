export {};

declare global {
  interface Window {
    electronAPI: {
      selectFolder: () => Promise<string | null>;
    };
  }
}

declare module 'react' {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    webkitdirectory?: 'true' | 'false' | '';
    directory?: string;
  }
}
