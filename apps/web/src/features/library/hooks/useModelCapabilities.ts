import { useMemo } from 'react';

interface ModelDetails {
  parameter_size?: string | null;
  quantization_level?: string | null;
  family?: string | null;
}

/**
 * Hook to detect model capabilities and hardware fit based on name and details.
 */
export const useModelCapabilities = (name: string, details?: ModelDetails) => {
  return useMemo(() => {
    const nameLower = name.toLowerCase();
    const isVision = nameLower.includes('llava') || nameLower.includes('vision');
    const isCode = nameLower.includes('code') || nameLower.includes('coder');
    const isReasoning = nameLower.includes('r1') || nameLower.includes('reasoner');

    const paramSize = details?.parameter_size?.toLowerCase() || '';
    const isHeavy =
      paramSize.includes('70b') || paramSize.includes('110b') || paramSize.includes('405b');
    const isLight =
      paramSize.includes('1b') || paramSize.includes('3b') || paramSize.includes('8b');

    return {
      isVision,
      isCode,
      isReasoning,
      isHeavy,
      isLight,
    };
  }, [name, details]);
};
