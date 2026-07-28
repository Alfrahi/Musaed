import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AttachmentPreview from './AttachmentPreview';

vi.mock('@/lib/i18n', async () => {
  const actual = await vi.importActual('@/lib/i18n');
  return {
    ...(actual as object),
    useTranslation: () => ({
      t: (key: string) => key,
      formatNumber: (num: number) => num.toString(),
      formatDate: (date: number | Date) => String(date),
      isRtl: false,
      formatFileSize: (bytes: number) => `${bytes} B`,
    }),
  };
});

vi.mock('@/store', () => ({
  useLanguage: () => 'en',
  useSettingsStore: () => ({
    globalSettings: { language: 'en' },
  }),
}));

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: { alt: string; [k: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} {...props} />
  ),
}));

describe('AttachmentPreview', () => {
  const onRemoveImage = vi.fn();
  const onRemoveFile = vi.fn();

  it('renders nothing when both images and files are empty', () => {
    const { container } = render(
      <AttachmentPreview
        images={[]}
        files={[]}
        onRemoveImage={onRemoveImage}
        onRemoveFile={onRemoveFile}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders image previews with remove buttons', () => {
    render(
      <AttachmentPreview
        images={['img1.png']}
        files={[]}
        onRemoveImage={onRemoveImage}
        onRemoveFile={onRemoveFile}
      />
    );
    const removeBtn = screen.getByRole('button');
    expect(removeBtn).toBeInTheDocument();
    fireEvent.click(removeBtn);
    expect(onRemoveImage).toHaveBeenCalledWith(0);
  });

  it('renders file previews with remove buttons', () => {
    render(
      <AttachmentPreview
        images={[]}
        files={[{ name: 'doc.pdf', size: 1024, type: 'application/pdf', content: '' }]}
        onRemoveImage={onRemoveImage}
        onRemoveFile={onRemoveFile}
      />
    );
    const removeBtn = screen.getByRole('button');
    expect(removeBtn).toBeInTheDocument();
    fireEvent.click(removeBtn);
    expect(onRemoveFile).toHaveBeenCalledWith(0);
  });

  it('image remove button has 24×24 px minimum tap target (WCAG 2.5.5)', () => {
    render(
      <AttachmentPreview
        images={['img1.png']}
        files={[]}
        onRemoveImage={onRemoveImage}
        onRemoveFile={onRemoveFile}
      />
    );
    const btn = screen.getByRole('button');
    expect(btn.className).toMatch(/\bmin-w-6\b/);
    expect(btn.className).toMatch(/\bmin-h-6\b/);
  });

  it('file remove button has 24×24 px minimum tap target (WCAG 2.5.5)', () => {
    render(
      <AttachmentPreview
        images={[]}
        files={[{ name: 'doc.pdf', size: 1024, type: 'application/pdf', content: '' }]}
        onRemoveImage={onRemoveImage}
        onRemoveFile={onRemoveFile}
      />
    );
    const btn = screen.getByRole('button');
    expect(btn.className).toMatch(/\bmin-w-6\b/);
    expect(btn.className).toMatch(/\bmin-h-6\b/);
  });
});
