import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * If a streaming response currently has an odd number of triple-backtick fences,
 * temporarily close the fence so the in-progress code block renders cleanly.
 */
function closeUnfinishedFence(markdown: string): string {
  const fenceMatches = markdown.match(/```/g);
  if (fenceMatches && fenceMatches.length % 2 === 1) {
    return `${markdown}\n\`\`\``;
  }
  return markdown;
}

@Pipe({
  name: 'markdown',
  standalone: true,
  pure: true,
})
export class MarkdownPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(value: string | null | undefined): SafeHtml {
    if (!value) {
      return '';
    }
    const prepared = closeUnfinishedFence(value);
    const rawHtml = marked.parse(prepared, { async: false }) as string;
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true },
    });
    return this.sanitizer.bypassSecurityTrustHtml(cleanHtml);
  }
}
