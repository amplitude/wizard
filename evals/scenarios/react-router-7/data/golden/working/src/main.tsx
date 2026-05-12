import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { init } from '@amplitude/unified';
import { Home } from './routes/home';
import { SignUp } from './routes/signup';

const apiKey = import.meta.env.VITE_AMPLITUDE_API_KEY;
if (apiKey) {
  init(apiKey, {
    // Auto-capture page views, clicks, sessions, form interactions.
    // Toggle off whichever signal you don't need — every flag here is
    // documented at https://amplitude.com/docs.
    autocapture: true,
  });
}

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/signup', element: <SignUp /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
