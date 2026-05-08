import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { Home } from './routes/home';
import { SignUp } from './routes/signup';

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/signup', element: <SignUp /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
