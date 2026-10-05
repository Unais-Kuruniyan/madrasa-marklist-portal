import { useEffect, useState } from 'react';

export type Route =
  | { name: 'dashboard' }
  | { name: 'new-class' }
  | { name: 'class'; id: string; examId?: string }
  | { name: 'edit-class'; id: string }
  | { name: 'print'; id: string; examId?: string }
  | { name: 'not-found' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);

  if (parts.length === 0) return { name: 'dashboard' };
  if (parts[0] !== 'classes') return { name: 'not-found' };
  if (parts.length === 2 && parts[1] === 'new') return { name: 'new-class' };
  if (parts.length === 2) return { name: 'class', id: parts[1] };
  if (parts.length === 4 && parts[2] === 'exam') return { name: 'class', id: parts[1], examId: parts[3] };
  if (parts.length === 3 && parts[2] === 'edit') return { name: 'edit-class', id: parts[1] };
  if (parts.length === 3 && parts[2] === 'print') return { name: 'print', id: parts[1] };
  if (parts.length === 5 && parts[2] === 'print' && parts[3] === 'exam') return { name: 'print', id: parts[1], examId: parts[4] };
  return { name: 'not-found' };
}

export const paths = {
  dashboard: () => '#/',
  newClass: () => '#/classes/new',
  classPage: (id: string, examId?: string) =>
    examId ? `#/classes/${encodeURIComponent(id)}/exam/${encodeURIComponent(examId)}` : `#/classes/${encodeURIComponent(id)}`,
  editClass: (id: string) => `#/classes/${encodeURIComponent(id)}/edit`,
  print: (id: string, examId?: string) =>
    examId ? `#/classes/${encodeURIComponent(id)}/print/exam/${encodeURIComponent(examId)}` : `#/classes/${encodeURIComponent(id)}/print`,
};

export function navigate(hash: string): void {
  if (window.location.hash !== hash) window.location.hash = hash;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}
