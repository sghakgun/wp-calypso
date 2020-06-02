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

/**
 * External dependencies
 */
import mockFs from 'mock-fs';
import cloneDeep from 'lodash/cloneDeep';

/**
 * Internal dependencies
 */
import appFactory from '../index';
import config from 'config';
import { attachBuildTimestamp, attachHead, attachI18n, renderJsx } from 'server/render';
import sanitize from 'server/sanitize';
import { isWooOAuth2Client } from 'lib/oauth2-clients';

const runApp = async ( { request = {}, response = {} } ) => {
	const app = appFactory();
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

const assertDefaultContext = ( { url, entry } ) => {
	it( 'sets the commit sha if known', async () => {
		const { request } = await runApp( { request: { url } } );
		expect( request.context.commitSha ).toBe( 'abcabc' );
	} );

	it( 'sets the commit sha if unknown', async () => {
		delete process.env.COMMIT_SHA;
		const { request } = await runApp( { request: { url } } );
		expect( request.context.commitSha ).toBe( '(unknown)' );
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
};

describe( 'main app', () => {
	beforeEach( () => {
		config.isEnabled.mockImplementation( ( key ) => key === 'use-translation-chunks' );

		mockFs( {
			'/Users/sergio/src/automattic/wp-calypso/client/server/bundler/assets-fallback.json': JSON.stringify(
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

		process.env.COMMIT_SHA = 'abcabc';
	} );

	afterEach( async () => {
		mockFs.restore();
		jest.clearAllMocks();
		delete process.env.COMMIT_SHA;
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
			config.isEnabled.mockImplementation( ( key ) => {
				switch ( key ) {
					case 'reader':
						return false;
					case 'stats':
						return true;
				}
			} );

			const { response } = await runApp( {
				request: {
					url: '/',
				},
			} );

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
