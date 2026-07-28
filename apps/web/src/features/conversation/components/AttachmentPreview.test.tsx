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
    // There are two buttons: the thumbnail (with aria-label) and the remove (no label)
    const buttons = screen.getAllByRole('button');
    const removeButton = buttons.find((b) => !b.getAttribute('aria-label'));
    expect(removeButton).toBeInTheDocument();
    fireEvent.click(removeButton!);
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
    const buttons = screen.getAllByRole('button');
    const removeButton = buttons.find((b) => !b.getAttribute('aria-label'));
    expect(removeButton).toBeTruthy();
    expect(removeButton!.className).toMatch(/\bmin-w-6\b/);
    expect(removeButton!.className).toMatch(/\bmin-h-6\b/);
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

  it('opens lightbox on image thumbnail click', () => {
    render(
      <AttachmentPreview
        images={['data:image/png;base64,abc']}
        files={[]}
        onRemoveImage={onRemoveImage}
        onRemoveFile={onRemoveFile}
      />
    );
    const buttons = screen.getAllByRole('button');
    const thumbnailBtn = buttons.find((b) => b.getAttribute('aria-label') === 'common.preview');
    expect(thumbnailBtn).toBeTruthy();
    fireEvent.click(thumbnailBtn!);
    // Lightbox should now be open — the close button with a11y.closePreview label
    expect(screen.getByLabelText('a11y.closePreview')).toBeInTheDocument();
  });

  it('closes lightbox on close button click', () => {
    render(
      <AttachmentPreview
        images={['data:image/png;base64,abc']}
        files={[]}
        onRemoveImage={onRemoveImage}
        onRemoveFile={onRemoveFile}
      />
    );
    const buttons = screen.getAllByRole('button');
    const thumbnailBtn = buttons.find((b) => b.getAttribute('aria-label') === 'common.preview');
    fireEvent.click(thumbnailBtn!);

    const closeBtn = screen.getByLabelText('a11y.closePreview');
    fireEvent.click(closeBtn);
    // Lightbox should be closed — close button should no longer be in the DOM
    expect(screen.queryByLabelText('a11y.closePreview')).not.toBeInTheDocument();
  });
});
