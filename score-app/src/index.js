import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import './index.css';
import { AuthProvider } from "./context/AuthContext";
import { Toaster } from "react-hot-toast";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <AuthProvider>
    <Toaster position="top-center" />
    <App />
  </AuthProvider>
);