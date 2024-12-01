import { create } from "zustand";
import { MutableRefObject } from "react";

interface TextState {
  inputText: string;
  setInputText: (text: string) => void;

  outputText: string;
  setOutputText: (text: string) => void;

  processingLoading: boolean;
  setProcessingLoading: (loading: boolean) => void;

  rerender: number;
  triggerRerender: () => void;
}

export const useTextSTore = create<TextState>((set, get) => ({

  inputText: "",
  setInputText: (text: string) => set({ inputText: text }),

  outputText: "",
  setOutputText: (text: string) => set({ outputText: text }),

  processingLoading: false,
  setProcessingLoading: (loading: boolean) => set({ processingLoading: loading }),

  rerender: 0,
  triggerRerender: () => set({ rerender: get().rerender + 1 }),
}));