export interface AuthWrapperProps {
  children: React.ReactNode;
  requireAuth?: boolean;
  fallbackComponent?: React.ReactNode;
  showLoadingSpinner?: boolean;
}
