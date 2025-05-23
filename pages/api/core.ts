import Router, { RouterParamContext } from '@koa/router';
import { Context, Middleware } from 'koa';
import { HTTPError } from 'koajax';
import { DataObject } from 'mobx-restful';
import { KoaOption, withKoa, withKoaRouter } from 'next-ssr-middleware';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { parse } from 'yaml';

const { HTTP_PROXY } = process.env;

if (HTTP_PROXY) setGlobalDispatcher(new ProxyAgent(HTTP_PROXY));

export const safeAPI: Middleware<any, any> = async (context: Context, next) => {
  try {
    return await next();
  } catch (error) {
    if (!(error instanceof HTTPError)) {
      console.error(error);

      context.status = 400;

      return (context.body = { message: (error as Error).message });
    }
    const { message, response } = error;
    let { body } = response;

    context.status = response.status;
    context.statusMessage = message;

    if (body instanceof ArrayBuffer)
      try {
        body = new TextDecoder().decode(new Uint8Array(body));

        body = JSON.parse(body);
      } catch {
        //
      }
    console.error(JSON.stringify(body, null, 2));

    context.body = body;
  }
};

export const withSafeKoa = <S, C>(...middlewares: Middleware<S, C>[]) =>
  withKoa<S, C>({} as KoaOption, safeAPI, ...middlewares);

export const withSafeKoaRouter = <S, C extends RouterParamContext<S>>(
  router: Router<S, C>,
  ...middlewares: Middleware<S, C>[]
) => withKoaRouter<S, C>({} as KoaOption, router, safeAPI, ...middlewares);

export interface ArticleMeta {
  name: string;
  path?: string;
  meta?: DataObject;
  subs: ArticleMeta[];
}

const MDX_pattern = /\.mdx?$/;

export async function frontMatterOf(path: string) {
  const { readFile } = await import('fs/promises');

  const file = await readFile(path, 'utf-8');

  const [, frontMatter] = file.match(/^---[\r\n]([\s\S]+?[\r\n])---/) || [];

  return frontMatter && parse(frontMatter);
}

export async function* pageListOf(
  path: string,
  prefix = 'pages',
): AsyncGenerator<ArticleMeta> {
  const { readdir } = await import('fs/promises');

  const list = await readdir(prefix + path, { withFileTypes: true });

  for (const node of list) {
    let { name, path } = node;

    if (name.startsWith('.')) continue;

    const isMDX = MDX_pattern.test(name);

    name = name.replace(MDX_pattern, '');
    path = `${path}/${name}`.replace(new RegExp(`^${prefix}`), '');

    if (node.isFile())
      if (isMDX) {
        const article: ArticleMeta = { name, path, subs: [] };
        try {
          const meta = await frontMatterOf(`${node.path}/${node.name}`);

          if (meta) article.meta = meta;
        } catch (error) {
          console.error(error);
        }
        yield article;
      } else continue;

    if (!node.isDirectory()) continue;

    const subs = await Array.fromAsync(pageListOf(path, prefix));

    if (subs[0]) yield { name, subs };
  }
}

export type TreeNode<K extends string> = {
  [key in K]: TreeNode<K>[];
};

export function* traverseTree<K extends string>(
  tree: TreeNode<K>,
  key: K,
): Generator<TreeNode<K>> {
  for (const node of tree[key] || []) {
    yield node;
    yield* traverseTree(node, key);
  }
}
