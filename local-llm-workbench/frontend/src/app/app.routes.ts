import { Routes } from '@angular/router';
import { Chat } from './features/chat/chat';
import { Servers } from './features/servers/servers';
import { Starter } from './features/starter/starter';

export const routes: Routes = [
  { path: '', redirectTo: 'chat', pathMatch: 'full' },
  { path: 'chat', component: Chat },
  { path: 'servers', component: Servers },
  { path: 'endpoints', component: Starter },
  { path: '**', redirectTo: 'chat' },
];
