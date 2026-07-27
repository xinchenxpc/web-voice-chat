import { BrowserRouter, Routes, Route } from "react-router";
import { ToastProvider } from "./components/ToastContext";
import Login from "./login";
import Home from "./home";

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/home" element={<Home />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
