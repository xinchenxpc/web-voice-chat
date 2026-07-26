import Login from './login'
import { loginUser } from './longinState'
import './App.css'

function page() { 
  if(loginUser() == null){
    return <Login />
  }
  return <Home />
}

function App() {
  return (
    <>
      {page()}
    </>
  )
}

export default App
