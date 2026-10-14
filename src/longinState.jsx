import cookie from 'react-cookies'
import Login from './login'

export const loginUser = () => {
    return cookie.load('userInfo')
}

export const onLogin = (user) => {
    cookie.save('userInfo', user, { path: '/' })
}

export const logout = () => {
    cookie.remove('userInfo', { path: '/' })
    return (
        <Login></Login>
    )
}
