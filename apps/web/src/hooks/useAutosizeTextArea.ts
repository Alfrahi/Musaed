'use client';

import { useEffect } from 'react';

export const useAutosizeTextArea = (textAreaRef: HTMLTextAreaElement | null, value: string) => {
  useEffect(() => {
    if (textAreaRef) {
      // Forcing height to 0px triggers a layout reflow to calculate accurate scrollHeight for shrinking.
      textAreaRef.style.height = '0px';
      const scrollHeight = textAreaRef.scrollHeight;
      textAreaRef.style.height = scrollHeight + 'px';
    }
  }, [textAreaRef, value]);
};
