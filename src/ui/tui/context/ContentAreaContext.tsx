import { createContext, useContext } from 'react';

export interface ContentAreaMetrics {
  height: number;
  width: number;
}

export const ContentAreaContext = createContext<ContentAreaMetrics | null>(
  null,
);

export function useContentArea(): ContentAreaMetrics | null {
  return useContext(ContentAreaContext);
}
