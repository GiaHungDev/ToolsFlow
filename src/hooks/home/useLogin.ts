export const useLogin = () => {
  const handleLoginClick = (): void => {
    console.log("Login button clicked");
    // Add your login logic here
  };

  const handleGetStarted = (): void => {
    console.log("Get started button clicked");
    // Add your get started logic here
  };

  return {
    handleLoginClick,
    handleGetStarted,
  };
};
