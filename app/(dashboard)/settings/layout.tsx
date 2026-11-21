import type {ReactNode} from 'react';
import SettingsFrame from './settings-frame';

export default function SettingsLayout({children}:{children:ReactNode}){
 return <SettingsFrame>{children}</SettingsFrame>;
}
