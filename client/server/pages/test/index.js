jest.mock( 'sections', () => {
	const sections = jest.requireActual( 'sections' );
	sections
		.filter( ( section ) => section.isomorphic )
		.forEach( ( section ) => {
			section.load = jest.fn( () => ( {
				default: jest.fn(),
			} ) );
		} );
	return sections;
} );

jest.mock( 'server/render', () => ( {
	serverRender: jest.fn( ( req, res ) => res.send( '' ) ),
	renderJsx: jest.fn(),
	attachBuildTimestamp: jest.fn(),
	attachHead: jest.fn(),
	attachI18n: jest.fn(),
} ) );

jest.mock( 'server/sanitize', () => jest.fn() );

jest.mock( 'lib/oauth2-clients', () => ( {
	isWooOAuth2Client: jest.fn(),
} ) );

jest.mock( 'config', () => {
	const impl = jest.fn( ( key ) => {
		const config = {
			hostname: 'valid.hostname',
			magnificent_non_en_locales: [ 'ar', 'es' ],
			port: 3000,
			env_id: 'stage',
			rtl: true,
			discover_logged_out_redirect_url: 'http://discover.url/',
			i18n_default_locale_slug: 'en',
			favicon_url: 'http://favicon.url/',
		};
		return config[ key ];
	} );
	impl.isEnabled = jest.fn();
	impl.clientData = {
		client: 'data',
	};
	return impl;
} );

jest.mock( 'login', () => {
	const impl = jest.fn();
	impl.LOGIN_SECTION_DEFINITION = {
		name: 'login',
		paths: [ '/log-in' ],
		module: 'login',
		enableLoggedOut: true,
		secondary: false,
		isomorphic: true,
	};
	return impl;
} );

jest.mock( 'browserslist-useragent', () => ( {
	matchesUA: jest.fn(),
} ) );

jest.mock( 'state', () => ( {
	createReduxStore: jest.fn(),
} ) );

/**
 * External dependencies
 */
import mockFs from 'mock-fs';
import cloneDeep from 'lodash/cloneDeep';
import { matchesUA } from 'browserslist-useragent';

/**
 * Internal dependencies
 */
import appFactory from '../index';
import config from 'config';
import { attachBuildTimestamp, attachHead, attachI18n, renderJsx } from 'server/render';
import sanitize from 'server/sanitize';
import { createReduxStore } from 'state';

const runApp = async ( { app = appFactory(), request = {}, response = {} } = {} ) => {
	return new Promise( ( resolve ) => {
		const mockRequest = {
			body: {},
			cookies: {},
			query: {},
			params: {},
			// Setup by parent app using 'express-useragent'
			useragent: {
				source: '',
			},
			headers: {
				'user-agent': '',
			},
			url: '/',
			method: 'GET',
			get: jest.fn(),
			connection: {},
			...request,
		};
		// Using cloneDeep to capture the state of the request/response objects right now, in case
		// an async middleware changes them _after_ the request handler has been executed
		const mockResponse = {
			setHeader: jest.fn(),
			getHeader: jest.fn(),
			send: jest.fn( () => {
				resolve( { request: cloneDeep( mockRequest ), response: cloneDeep( mockResponse ) } );
			} ),
			end: jest.fn( () => {
				resolve( { request: cloneDeep( mockRequest ), response: cloneDeep( mockResponse ) } );
			} ),
			redirect: jest.fn( () => {
				resolve( { request: cloneDeep( mockRequest ), response: cloneDeep( mockResponse ) } );
			} ),
			...response,
		};
		app( mockRequest, mockResponse );
	} );
};

const mockFilesystem = () => {
	mockFs( {
		'/Users/sergio/src/automattic/wp-calypso/client/server/bundler/assets-fallback.json': JSON.stringify(
			{
				manifests: {
					manifest: '/* webpack manifest */',
				},
				entrypoints: {
					'entry-main': {
						assets: [
							'/calypso/evergreen/entry-main.1.min.js',
							'/calypso/evergreen/entry-main.2.min.js',
							'/calypso/evergreen/entry-main.3.min.css',
							'/calypso/evergreen/entry-main.4.min.rtl.css',
						],
					},
					'entry-domains-landing': {
						assets: [
							'/calypso/evergreen/entry-domains-landing.1.min.js',
							'/calypso/evergreen/entry-domains-landing.2.min.js',
							'/calypso/evergreen/entry-domains-landing.3.min.css',
							'/calypso/evergreen/entry-domains-landing.4.min.rtl.css',
						],
					},
				},
				chunks: [
					{
						names: [ 'root' ],
						files: [ '/calypso/root.js' ],
						siblings: [],
					},
				],
			}
		),
		'/Users/sergio/src/automattic/wp-calypso/client/server/bundler/assets-evergreen.json': JSON.stringify(
			{
				manifests: {},
				entrypoints: {
					'entry-main': {
						assets: [],
					},
					'entry-domains-landing': {
						assets: [],
					},
				},
				chunks: [
					{
						names: [ 'root' ],
						files: [ '/calypso/root.js' ],
						siblings: [],
					},
				],
			}
		),
	} );
};

const appFactoryWithCustomEnvironment = ( env, setMocks = () => {} ) => {
	let isolatedAppFactory;
	jest.resetModules();
	mockFs.restore();
	jest.isolateModules( () => {
		require( 'config' ).mockImplementation( ( key ) => {
			return key === 'env_id' ? env : undefined;
		} );
		setMocks();
		isolatedAppFactory = require( '../index' );
	} );
	mockFilesystem();
	return isolatedAppFactory;
};

const withEvergreenBrowser = ( mock = matchesUA ) => {
	mock.mockImplementation( () => {
		return true;
	} );
};

const withNonEvergreenBrowser = ( mock = matchesUA ) => {
	mock.mockImplementation( () => false );
};

const withMockedVariable = ( object, name ) => {
	const valueExists = name in object;
	const oldValue = object[ name ];

	return [
		( value ) => {
			object[ name ] = value;
		},
		() => {
			if ( valueExists ) object[ name ] = oldValue;
			else delete object[ name ];
		},
	];
};

const withConfigEnabled = ( enabledOptions ) => {
	config.isEnabled.mockImplementation( ( key ) => {
		return enabledOptions[ key ];
	} );
};

const assertDefaultContext = ( { url, entry } ) => {
	describe( 'sets the commit sha', () => {
		const [ setCommitSha, resetCommitSha ] = withMockedVariable( process.env, 'COMMIT_SHA' );

		afterEach( () => {
			resetCommitSha();
		} );

		it( 'uses the value from COMMIT_SHA', async () => {
			setCommitSha( 'abcabc' );
			const { request } = await runApp( { request: { url } } );
			expect( request.context.commitSha ).toBe( 'abcabc' );
		} );

		it( 'defaults to "(unknown)"', async () => {
			const { request } = await runApp( { request: { url } } );
			expect( request.context.commitSha ).toBe( '(unknown)' );
		} );
	} );

	it( 'sets the debug mode for the compiler', async () => {
		const { request } = await runApp( { request: { url } } );
		expect( request.context.compileDebug ).toBe( false );
	} );

	it( 'sets the user to false', async () => {
		const { request } = await runApp( { request: { url } } );
		expect( request.context.user ).toBe( false );
	} );

	it( 'sets the environment', async () => {
		const { request } = await runApp( { request: { url } } );
		expect( request.context.env ).toBe( 'stage' );
	} );

	it( 'sets the sanitize method', async () => {
		const { request } = await runApp( { request: { url } } );
		expect( request.context.sanitize ).toEqual( sanitize );
	} );

	it( 'sets the RTL', async () => {
		const { request } = await runApp( { request: { url } } );
		expect( request.context.isRTL ).toEqual( true );
	} );

	it( 'sets requestFrom', async () => {
		const { request } = await runApp( { request: { url, query: { from: 'from' } } } );
		expect( request.context.requestFrom ).toEqual( 'from' );
	} );

	it( 'sets lang to the default', async () => {
		const { request } = await runApp( { request: { url } } );
		expect( request.context.lang ).toEqual( 'en' );
	} );

	it( 'sets the entrypoint', async () => {
		const { request } = await runApp( { request: { url } } );
		expect( request.context.entrypoint ).toEqual( {
			js: [ `/calypso/evergreen/${ entry }.1.min.js`, `/calypso/evergreen/${ entry }.2.min.js` ],
			'css.ltr': [ `/calypso/evergreen/${ entry }.3.min.css` ],
			'css.rtl': [ `/calypso/evergreen/${ entry }.4.min.rtl.css` ],
		} );
	} );

	it( 'sets the manifest', async () => {
		const { request } = await runApp( { request: { url } } );
		expect( request.context.manifest ).toEqual( '/* webpack manifest */' );
	} );

	it( 'sets the favicon_url', async () => {
		const { request } = await runApp( { request: { url } } );
		expect( request.context.faviconURL ).toEqual( 'http://favicon.url/' );
	} );

	describe( 'sets the abTestHepler', () => {
		it( 'when config is enabled', async () => {
			withConfigEnabled( { 'dev/test-helper': true } );

			const { request } = await runApp( { request: { url } } );

			expect( request.context.abTestHelper ).toEqual( true );
		} );

		it( 'when config is disabled', async () => {
			withConfigEnabled( { 'dev/test-helper': false } );

			const { request } = await runApp( { request: { url } } );

			expect( request.context.abTestHelper ).toEqual( false );
		} );
	} );

	describe( 'sets the preferencesHelper', () => {
		it( 'when config is enabled', async () => {
			withConfigEnabled( { 'dev/preferences-helper': true } );

			const { request } = await runApp( { request: { url } } );

			expect( request.context.preferencesHelper ).toEqual( true );
		} );

		it( 'when config is disabled', async () => {
			withConfigEnabled( { 'dev/preferences-helper': false } );

			const { request } = await runApp( { request: { url } } );

			expect( request.context.preferencesHelper ).toEqual( false );
		} );
	} );

	it( 'sets devDocsUrl', async () => {
		const { request } = await runApp( { request: { url } } );
		expect( request.context.devDocsURL ).toEqual( '/devdocs' );
	} );

	it( 'sets redux store', async () => {
		const theStore = {};
		createReduxStore.mockImplementation( () => theStore );

		const { request } = await runApp( { request: { url } } );

		expect( request.context.store ).toEqual( theStore );
	} );

	it( 'sets the evergreen for evergreen browsers check in production', async () => {
		const isolatedAppFactory = appFactoryWithCustomEnvironment( 'production', () => {
			withEvergreenBrowser( require( 'browserslist-useragent' ).matchesUA );
		} );

		const { request } = await runApp( { app: isolatedAppFactory(), request: { url } } );

		expect( request.context.addEvergreenCheck ).toEqual( true );
	} );

	describe( 'sets the target', () => {
		const [ setNodeEnv, resetNodeEnv ] = withMockedVariable( process.env, 'NODE_ENV' );

		describe( 'in development mode', () => {
			const [ setDevTarget, resetDevTarget ] = withMockedVariable( process.env, 'DEV_TARGET' );

			beforeEach( () => {
				setNodeEnv( 'development' );
			} );

			afterEach( () => {
				resetNodeEnv();
				resetDevTarget();
			} );

			it( 'uses the value from DEV_TARGET ', async () => {
				setDevTarget( 'fallback' );
				const { request } = await runApp( { request: { url } } );
				expect( request.context.target ).toEqual( 'fallback' );
			} );

			it( 'defaults to evergreen when DEV_TARGET is not set', async () => {
				const { request } = await runApp( { request: { url } } );
				expect( request.context.target ).toEqual( 'evergreen' );
			} );
		} );

		describe( 'in production mode', () => {
			beforeEach( () => {
				setNodeEnv( 'production' );
			} );

			afterEach( () => {
				resetNodeEnv();
			} );

			it( 'uses fallback if forceFallback is provided as query', async () => {
				const { request } = await runApp( { request: { url, query: { forceFallback: true } } } );
				expect( request.context.target ).toEqual( 'fallback' );
			} );

			it( 'serves evergreen for evergreen browsers', async () => {
				withEvergreenBrowser();

				const { request } = await runApp( { request: { url } } );

				expect( request.context.target ).toEqual( 'evergreen' );
			} );

			it( 'serves fallback if the browser is not evergreen', async () => {
				withNonEvergreenBrowser();

				const { request } = await runApp( { request: { url } } );

				expect( request.context.target ).toEqual( 'fallback' );
			} );
		} );

		describe( 'in desktop mode', () => {
			it( 'defaults to fallback in desktop mode', async () => {
				const isolatedAppFactory = appFactoryWithCustomEnvironment( 'desktop', () => {
					withEvergreenBrowser( require( 'browserslist-useragent' ).matchesUA );
				} );

				const { request } = await runApp( { app: isolatedAppFactory(), request: { url } } );

				expect( request.context.target ).toEqual( 'fallback' );
			} );

			it( 'defaults to fallback in desktop-development mode', async () => {
				const isolatedAppFactory = appFactoryWithCustomEnvironment( 'desktop-development', () => {
					withEvergreenBrowser( require( 'browserslist-useragent' ).matchesUA );
				} );

				const { request } = await runApp( { app: isolatedAppFactory(), request: { url } } );

				expect( request.context.target ).toEqual( 'fallback' );
			} );
		} );
	} );

	describe( 'uses translations chunks', () => {
		it( 'disabled by default', async () => {
			const { request } = await runApp( { request: { url } } );

			expect( request.context.useTranslationChunks ).toEqual( false );
		} );

		it( 'when enabled in the config', async () => {
			withConfigEnabled( {
				'use-translation-chunks': true,
			} );

			const { request } = await runApp( { request: { url } } );

			expect( request.context.useTranslationChunks ).toEqual( true );
		} );

		it( 'when enabled in the request flags', async () => {
			const { request } = await runApp( {
				request: { url },
				query: { flags: 'use-translation-chunks' },
			} );

			expect( request.context.useTranslationChunks ).toEqual( true );
		} );

		it( 'when specified in the request', async () => {
			const { request } = await runApp( {
				request: { url },
				query: { useTranslationChunks: true },
			} );

			expect( request.context.useTranslationChunks ).toEqual( true );
		} );
	} );
};

describe( 'main app', () => {
	beforeEach( () => {
		mockFilesystem();
	} );

	afterEach( async () => {
		mockFs.restore();
		jest.clearAllMocks();
	} );

	describe( 'Middleware loggedInContext', () => {
		it( 'detects if it is a support session based on a header', async () => {
			const { request } = await runApp( {
				request: {
					get: jest.fn( ( header ) => header === 'x-support-session' ),
				},
			} );

			expect( request.context.isSupportSession ).toBe( true );
		} );

		it( 'detects if it is a support session based on a cookie', async () => {
			const { request } = await runApp( {
				request: {
					cookies: {
						support_session_id: true,
					},
				},
			} );

			expect( request.context.isSupportSession ).toBe( true );
		} );

		it( 'detects if it is logged in based on a cookie', async () => {
			const { request } = await runApp( {
				request: {
					cookies: {
						wordpress_logged_in: true,
					},
				},
			} );

			expect( request.context.isLoggedIn ).toBe( true );
		} );
	} );

	describe( 'Middleware localSubdomains', () => {
		describe( 'sets locale info in the request context ', () => {
			it( 'rtl language', async () => {
				const { request } = await runApp( {
					request: {
						hostname: 'ar.valid.hostname',
					},
				} );

				expect( request.context.lang ).toBe( 'ar' );
				expect( request.context.isRTL ).toBe( true );
			} );
			it( 'non rtl language', async () => {
				const { request } = await runApp( {
					request: {
						hostname: 'es.valid.hostname',
					},
				} );

				expect( request.context.lang ).toBe( 'es' );
				expect( request.context.isRTL ).toBe( false );
			} );
		} );

		describe( 'strips language from the hostname for logged in users', () => {
			it( 'redirects to http', async () => {
				const { response } = await runApp( {
					request: {
						url: '/my-path',
						hostname: 'es.valid.hostname',
						cookies: {
							wordpress_logged_in: true,
						},
					},
				} );

				expect( response.redirect ).toHaveBeenCalledWith( 'http://valid.hostname:3000/my-path' );
			} );

			it( 'redirects to https', async () => {
				const { response } = await runApp( {
					request: {
						url: '/my-path',
						hostname: 'es.valid.hostname',
						get: jest.fn( ( header ) => ( header === 'X-Forwarded-Proto' ? 'https' : undefined ) ),
						cookies: {
							wordpress_logged_in: true,
						},
					},
				} );

				expect( response.redirect ).toHaveBeenCalledWith( 'https://valid.hostname:3000/my-path' );
			} );
		} );
	} );

	describe( 'Route /', () => {
		it( 'redirects to stats if reader is disabled', async () => {
			withConfigEnabled( {
				reader: false,
				stats: true,
			} );

			const { response } = await runApp( { request: { url: '/' } } );

			expect( response.redirect ).toHaveBeenCalledWith( '/stats' );
		} );
	} );

	describe( 'Route /sites/:site/:section', () => {
		[
			{ section: 'posts', url: '/posts/my-site' },
			{ section: 'pages', url: '/pages/my-site' },
			{ section: 'sharing', url: '/sharing/my-site' },
			{ section: 'upgrade', url: '/upgrade/my-site' },
			{ section: 'checkout', url: '/checkout/my-site' },
			{ section: 'change-theme', url: '/themes' },
		].forEach( ( { section, url } ) => {
			it( `Redirects from old newdash format (section ${ section })`, async () => {
				const { response } = await runApp( {
					request: {
						url: `/sites/my-site/${ section }`,
					},
				} );

				expect( response.redirect ).toHaveBeenCalledWith( url );
			} );
		} );
	} );

	describe( 'Route /discover', () => {
		it( 'redirects to discover url for anonymous users', async () => {
			const { response } = await runApp( {
				request: {
					url: '/discover',
				},
			} );

			expect( response.redirect ).toHaveBeenCalledWith( 'http://discover.url/' );
		} );
	} );

	describe( 'Route /read/search', () => {
		it( 'redirects to public search for anonymous users', async () => {
			const { response } = await runApp( {
				request: {
					url: '/read/search',
					query: {
						q: 'my query',
					},
				},
			} );

			expect( response.redirect ).toHaveBeenCalledWith(
				'https://en.search.wordpress.com/?q=my%20query'
			);
		} );
	} );

	describe( 'Route /plans', () => {
		it( 'redirects to login if the request is for jetpack', async () => {
			const { response } = await runApp( {
				request: {
					url: '/plans',
					query: {
						for: 'jetpack',
					},
				},
			} );

			expect( response.redirect ).toHaveBeenCalledWith(
				'https://wordpress.com/wp-login.php?redirect_to=https%3A%2F%2Fwordpress.com%2Fplans'
			);
		} );

		it( 'redirects to public pricing page', async () => {
			const { response } = await runApp( {
				request: {
					url: '/plans',
				},
			} );

			expect( response.redirect ).toHaveBeenCalledWith( 'https://wordpress.com/pricing' );
		} );
	} );

	describe( 'Route /menus', () => {
		it( 'redirects to menus when there is a site', async () => {
			const { response } = await runApp( {
				request: {
					url: '/menus/my-site',
				},
			} );

			expect( response.redirect ).toHaveBeenCalledWith( 301, '/customize/menus/my-site' );
		} );

		it( 'redirects to menus when there is not a site', async () => {
			const { response } = await runApp( {
				request: {
					url: '/menus',
				},
			} );

			expect( response.redirect ).toHaveBeenCalledWith( 301, '/customize/menus/' );
		} );
	} );

	describe( 'Route /domains', () => {
		it( 'redirects from /domains to /start/domain', async () => {
			const { response } = await runApp( {
				request: {
					url: '/domains',
				},
			} );

			expect( response.redirect ).toHaveBeenCalledWith( '/start/domain' );
		} );

		it( 'redirects from /domains to /start/domain with selected domain', async () => {
			const { response } = await runApp( {
				request: {
					url: '/domains',
					query: {
						new: 'my-domain.com',
					},
				},
			} );

			expect( response.redirect ).toHaveBeenCalledWith( '/start/domain?new=my-domain.com' );
		} );

		it( 'redirects from /start/domain-first to /start/domain', async () => {
			const { response } = await runApp( {
				request: {
					url: '/start/domain-first',
				},
			} );

			expect( response.redirect ).toHaveBeenCalledWith( '/start/domain' );
		} );

		it( 'redirects from /start/domain-first to /start/domain with selected domain', async () => {
			const { response } = await runApp( {
				request: {
					url: '/start/domain-first',
					query: {
						new: 'my-domain.com',
					},
				},
			} );

			expect( response.redirect ).toHaveBeenCalledWith( '/start/domain?new=my-domain.com' );
		} );
	} );

	describe( 'Route /domain-services/:action', () => {
		it( 'attaches info to the context form server/render', async () => {
			await runApp( {
				request: {
					url: '/domain-services/renovate',
				},
			} );

			expect( attachBuildTimestamp ).toHaveBeenCalled();
			expect( attachI18n ).toHaveBeenCalled();
			expect( attachHead ).toHaveBeenCalled();
		} );

		it( 'adds clientData to the context', async () => {
			const { request } = await runApp( {
				request: {
					url: '/domain-services/renovate',
				},
			} );

			expect( request.context.clientData ).toEqual( { client: 'data' } );
		} );

		it( 'adds domainsLandingData to the context', async () => {
			const { request } = await runApp( {
				request: {
					url: '/domain-services/renovate',
					query: {
						domain: 'test',
					},
				},
			} );

			expect( request.context.domainsLandingData ).toEqual( {
				action: 'renovate',
				query: {
					domain: 'test',
				},
			} );
		} );

		it( 'renders domains-landing page', async () => {
			renderJsx.mockImplementation( () => '<div>page</div>' );

			const { response } = await runApp( {
				request: {
					url: '/domain-services/renovate',
					query: {
						domain: 'test',
					},
				},
			} );

			expect( renderJsx ).toHaveBeenCalledWith(
				'domains-landing',
				expect.objectContaining( {
					domainsLandingData: {
						action: 'renovate',
						query: {
							domain: 'test',
						},
					},
				} )
			);
			expect( response.send ).toHaveBeenCalledWith( '<div>page</div>' );
		} );

		assertDefaultContext( {
			url: '/domain-services/renovate',
			entry: 'entry-domains-landing',
		} );
	} );

	describe( 'Sections', () => {} );

	describe( 'Login', () => {} );

	describe( 'Gutenboarding', () => {} );

	describe( '/cspreport', () => {} );

	describe( '/browsehappy', () => {} );

	describe( '/support-user', () => {} );

	describe( '404', () => {} );

	describe( 'Error', () => {} );
} );
