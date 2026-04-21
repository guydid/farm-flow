import { createEntity, localAuth } from './localClient';

export const Query = createEntity('query');
export const User = localAuth;
