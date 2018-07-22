// Express requirements
import path from 'path';
import fs from 'fs';

// React requirements
import React from 'react';
import { renderToString } from 'react-dom/server';
import Helmet from 'react-helmet';
import { Provider } from 'react-redux';
import { StaticRouter } from 'react-router';
import { Frontload, frontloadServerRender } from 'react-frontload';
import Loadable from 'react-loadable';

import manifest from './../assets/manifest';
import createStore from './redux/store';
import eneConfigApp from './app/config';
import App from './app';

// LOADER
export default (req, res, dataResp = {}) => {
  /*
    A simple helper function to prepare the HTML markup. This loads:
      - Page title
      - SEO meta tags
      - Preloaded state (for Redux) depending on the current route
      - Code-split script tags depending on the current route
  */
  const injectHTML = (data, { html, title, meta, link, body, scripts, state }) => {
    data = data.replace('<html>', `<html ${html}>`);
    data = data.replace('{{META}}', meta); // META
    data = data.replace('{{LINK}}', link); // LINK
    data = data.replace(/<title>.*?<\/title>/g, title);
    data = data.replace(
      '<div id="root"></div>',
      `<div id="root">${body}</div><script>window.__PRELOADED_STATE__ = ${state}</script>`
    );
    data = data.replace('</body>', scripts + '</body>');

    return data;
  };

  // Load in our HTML file from our build
  fs.readFile(
    'assets/template.html',
    'utf8',
    (err, htmlData) => {
      // If there's an error... serve up something nasty
      if (err) {
        console.error('Read error', err);

        return res.status(404).end();
      }
      
      // Create a store (with a memory history) from our current url and initialState
      const initialState = Object.assign({logged: res.logged}, dataResp, {urlCurrent: `${req.url}`});
      const { store } = createStore(req.url, initialState);
      // If the user has a cookie (i.e. they're signed in) - set them as the current user
      // Otherwise, we want to set the current state to be logged out, just in case this isn't the default
      // if ('mywebsite' in req.cookies) {
      //   store.dispatch(setCurrentUser(req.cookies.mywebsite));
      // } else {
      //   store.dispatch(logoutUser());
      // }

      const context = {};
      const modules = [];

      /*
        Here's the core funtionality of this file. We do the following in specific order (inside-out):
          1. Load the <App /> component
          2. Inside of the Frontload HOC
          3. Inside of a Redux <StaticRouter /> (since we're on the server), given a location and context to write to
          4. Inside of the store provider
          5. Inside of the React Loadable HOC to make sure we have the right scripts depending on page
          6. Render all of this sexiness
          7. Make sure that when rendering Frontload knows to get all the appropriate preloaded requests

        In English, we basically need to know what page we're dealing with, and then load all the appropriate scripts and
        data for that page. We take all that information and compute the appropriate state to send to the user. This is
        then loaded into the correct components and sent as a Promise to be handled below.
      */
      frontloadServerRender(() =>
        renderToString(
          <Loadable.Capture report={m => modules.push(m)}>
            <Provider store={store}>
              <StaticRouter location={req.url} context={context}>
                <Frontload isServer>
                  <App />
                </Frontload>
              </StaticRouter>
            </Provider>
          </Loadable.Capture>
        )
      ).then(routeMarkup => {
        if (context.url) {
          // If context has a url property, then we need to handle a redirection in Redux Router
          res.writeHead(302, {
            Location: context.url
          });

          res.end();
        } else {
          // Otherwise, we carry on...

          // Let's give ourself a function to load all our page-specific JS assets for code splitting
          const extractAssets = (assets, chunks) =>
            Object.keys(assets)
              .filter(asset => chunks.indexOf(asset.replace('.js', '')) > -1)
              .map(k => assets[k]);

          // Let's format those assets into pretty <script> tags
          const extraChunks = extractAssets(manifest, modules).map(
            c => `<script type="text/javascript" src="/${c}"></script>`
          );

          // We need to tell Helmet to compute the right meta tags, title, and such
          const helmet = Helmet.renderStatic();

          // Pass all this nonsense into our HTML formatting function above
          const html = injectHTML(htmlData, {
            html: helmet.htmlAttributes.toString(),
            title: helmet.title.toString() === "" ? `<title>${eneConfigApp.title}</title>` : helmet.title.toString(),
            meta: helmet.meta.toString(),
            link: helmet.link.toString(),
            body: routeMarkup,
            scripts: helmet.script.toString() + extraChunks.join(''),
            state: JSON.stringify(store.getState()).replace(/</g, '\\u003c')
          });

          // We have all the final HTML, let's send it to the user already!
          res.send(html);
        }
      }).catch((err) => {
        res.sendStatus(404);
      });
    }
  );
};