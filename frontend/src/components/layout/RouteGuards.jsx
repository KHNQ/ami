import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { Spinner } from "../ui/Spinner.jsx";

function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center">
      <Spinner className="h-7 w-7 text-ink-3" />
    </div>
  );
}

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullScreenLoader />;
  if (status === "signed-out") return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}


export function RedirectIfAuthed() {
  const { status } = useAuth();
  if (status === "loading") return <FullScreenLoader />;
  if (status === "signed-in") return <Navigate to="/" replace />;
  return <Outlet />;
}
