import { Outlet } from "react-router-dom";
import { BackgroundGlow } from "../ui/BackgroundGlow.jsx";

export function AuthLayout() {
  return (
    <div className="flex min-h-dvh w-full flex-1 flex-col">
      <BackgroundGlow variant="auth" />
      <Outlet />
    </div>
  );
}
