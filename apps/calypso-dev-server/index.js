/* eslint-disable no-console */
const http = require( 'http' );

const appFactory = require( './app' );
const app = appFactory();

const { HOST, PORT, PROTO } = require( './config' );

const server = http.createServer( app );

server.on( 'clientError', ( err ) => {
	console.log( err );
} );
server.on( 'error', ( err ) => {
	console.log( err );
} );
server.listen( PORT, HOST, () => {
	console.log( `Listening on ${ PROTO }://${ HOST }:${ PORT }...` );
} );
