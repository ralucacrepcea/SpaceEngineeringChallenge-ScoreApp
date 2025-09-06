import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function PrivateRoute({ children }) {
  const { currentUser, loading } = useAuth();

  if (loading) return <div className="text-center mt-10">Loading...</div>;
  return currentUser ? children : <Navigate to="/login" />;
}
