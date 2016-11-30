const THREE = require('three');
const CANNON = require('../../public/cannon.min.js');

import { forOwn } from 'lodash';
import { getMeshData, setCannonPosition, setMeshPosition } from './utils';
import { myColors, fixedTimeStep, maxSubSteps } from './config';
import store from '../store';
import socket from '../socket';

import { loadGame, loadEnvironment } from './game';
import {controls, Player} from './player';
import { Food } from './food';

let scene, camera, canvas, renderer;
let world, groundMaterial, ballMaterial, shadowLight;
let geometry, material, groundShape, groundBody, hemisphereLight, ambientLight;
let timeFromStart = Date.now();
// variables for physics
let time, lastTime;
// camera
let raycastReference, raycastHeight;

let someColors = myColors();

export const init = () => {



  let { players, food } = store.getState();
  // initialize THREE scene, camera, renderer
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(65,
                                       window.innerWidth / window.innerHeight,
                                       1,
                                       2000);

  canvas = document.getElementById('canvas');

  renderer = new THREE.WebGLRenderer({alpha: true, canvas});
  renderer.setPixelRatio( window.devicePixelRatio );
  renderer.setSize(window.innerWidth / 1.5,
                   window.innerHeight / 1.5,
                   false);

  //This is the object that follows the ball and keeps its z/y rotation
  //It casts rays outwards to detect objects for the player
  raycastReference = new THREE.Object3D();
  // raycastHeight = 1;
  // raycastReference.position.y = raycastHeight;
  scene.add(raycastReference);

  //Attach the camera to lock behind the ball
 // raycastReference.add(camera);
scene.add(camera)
  //setupCollisions(raycastReference);


  // shading
  renderer.shadowMap.enabled = true;
  renderer.shadowMapSoft = true;


  // store set playerID to socket.id from store
  // playerID = socket.id;


  // initialize Cannon world
  world = new CANNON.World();
  world.gravity.set(0, 0, 0);
  world.broadphase = new CANNON.NaiveBroadphase();


  // initialize all existing players in room
  let newPlayer, newFood;

  forOwn(players, (data, id) => {
    //console.log(data)
    let isMainPlayer = id === socket.id;
    newPlayer = new Player(id, data, isMainPlayer);
    newPlayer.init();
    // if (isMainPlayer) player = newPlayer;
  });

  forOwn(food, (data, id) => {
    newFood = new Food(id, data);
    newFood.init();
  });


  // Adjust friction between ball & ground
  groundMaterial = new CANNON.Material('groundMaterial');
  ballMaterial = new CANNON.Material('ballMaterial');
  var groundGroundCm = new CANNON.ContactMaterial(ballMaterial, groundMaterial, {
      friction: 0.9,
      restitution: 0.0,
      contactEquationStiffness: 1e8,
      contactEquationRelaxation: 3,
      frictionEquationStiffness: 1e8,
      frictionEquationRegularizationTime: 3,
  });
  var ballCm = new CANNON.ContactMaterial(ballMaterial, ballMaterial, {
      friction: 0.0,
      restitution: 0.9
  });
  world.addContactMaterial(groundGroundCm);
  world.addContactMaterial(ballCm);

  createLevel();

  // add some fog
  //scene.fog = new THREE.Fog(myColors['blue'], 50, 950);


  // A hemiplane light is a gradient colored light;
  // the first parameter is the sky color, the second parameter is the ground color,
  // the third parameter is the intensity of the light
  hemisphereLight = new THREE.HemisphereLight(0xaaaaaa, 0x000000, 0.9);

  // A directional light shines from a specific direction.
  // It acts like the sun, that means that all the rays produced are parallel.
  shadowLight = new THREE.DirectionalLight(0xffffff, 0.9);

  // Allow shadow casting
  shadowLight.castShadow = true;

  // define the visible area of the projected shadow
  shadowLight.shadow.camera.left = -400;
  shadowLight.shadow.camera.right = 400;
  shadowLight.shadow.camera.top = 400;
  shadowLight.shadow.camera.bottom = -400;
  shadowLight.shadow.camera.near = 1;
  shadowLight.shadow.camera.far = 1000;

  // define the resolution of the shadow; the higher the better,
  // but also the more expensive and less performant

  shadowLight.shadow.mapSize.width = 512;
  shadowLight.shadow.mapSize.height = 512;

  // to activate the lights, just add them to the scene
  scene.add(hemisphereLight);
  scene.add(shadowLight);

  // an ambient light modifies the global color of a scene and makes the shadows softer

  ambientLight = new THREE.AmbientLight(someColors['green'], 0.5);
  scene.add(ambientLight);


  loadGame();

  //botInit();

  // Events
  window.addEventListener( 'resize', onWindowResize, false );
};

export function animate() {
  setTimeout( function() {

        requestAnimationFrame( animate );

        // this dispatch happens 30 times a second,
        // updating the local state with player's new info and emitting to server
        socket.emit('update_position', getMeshData(playerMesh));
    }, 1000 / 30 );

  let playerMesh = scene.getObjectByName(socket.id);
  if (playerMesh) {
    //Updates the raycast reference so that it follows the position of the player
    raycastReference.position.set(playerMesh.position.x, playerMesh.position.y, playerMesh.position.z);

    var playerPosition = new THREE.Vector3(playerMesh.position.x, playerMesh.position.y, playerMesh.position.z);

    var playerNormalToPlanet = playerPosition.normalize();

    var quaternionOnPlanet = new THREE.Quaternion();
    quaternionOnPlanet.setFromUnitVectors(new THREE.Vector3(0,1,0), playerNormalToPlanet);

    raycastReference.quaternion.copy(quaternionOnPlanet);

    // Set the direction of the light
    shadowLight.position.copy(playerMesh.position);
    shadowLight.position.multiplyScalar(1.2);

    // receive and process controls and camera
    if ( controls ) controls.update();

    // sync THREE mesh with Cannon mesh
    // Cannon's y & z are swapped from THREE, and w is flipped
  if (playerMesh.cannon) setMeshPosition(playerMesh);

   let { players } = store.getState();


    // for all other players
    forOwn(players, (currentPlayer, id) => {
      let currentMesh = scene.getObjectByName(id);
      if (currentPlayer !== socket.id && currentMesh) setCannonPosition(currentMesh);
    });

    // run physics
    time = Date.now();
    if (lastTime !== undefined) {
       let dt = (time - lastTime) / 1000;
       world.step(fixedTimeStep, dt, maxSubSteps);
    }
    lastTime = time;
  }

  loadEnvironment();
  render();
}

function render() {
  renderer.clear();
  renderer.render( scene, camera );
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio( window.devicePixelRatio );
  renderer.setSize(window.innerWidth / 1.5,
                   window.innerHeight / 1.5,
                   false);
}

function createLevel(){
 // planet creation
 var planet_geometry = new THREE.TetrahedronGeometry( 500, 4 );
 var planet_material = new THREE.MeshPhongMaterial( { color: someColors['red'], shading: THREE.FlatShading});
 var planet = new THREE.Mesh( planet_geometry, planet_material );

  planet.receiveShadow = true;

 scene.add(planet);

  // create Cannon planet
  var planetShape = new CANNON.Sphere(500);
  var planetBody = new CANNON.Body({ mass: 0, material:groundMaterial, shape: planetShape });
  world.add(planetBody);

 // create THREE moon
  // var box_geometry = new THREE.TetrahedronGeometry( 100 , 3)
  // var box_material = new THREE.MeshPhongMaterial( { color: "#F8B195", shading: THREE.FlatShading});
  // var moon = new THREE.Mesh( box_geometry, box_material );
  // ;
  // moon.position.set(0,0,-750);
  // moon.castShadow = true;
  
  // scene.add(moon);

  // create Cannon moon
  // var moonShape = new CANNON.Sphere(100);
  // var moonBody = new CANNON.Body({ mass: 0, material:groundMaterial, shape: moonShape });
  // moonBody.position.set(0,-750,0)
  // world.add(moonBody); // remove this when eaten

  // add event listener to moon


}

export { scene, camera, canvas, renderer, world, groundMaterial, ballMaterial, raycastReference, timeFromStart };

// function botInit(){
  // const bot_geometry = new THREE.BoxGeometry(1,1,1);
  // const bot_material = new THREE.MeshBasicMaterial( {color: 0x7777ff, wireframe: false} );
  // const bot = new THREE.Mesh( bot_geometry, bot_material );

  // bot.position.x = 1;
  // bot.position.y = 0;
  // bot.position.z = 1;
  // scene.add(bot);

  // //create random directions for bot
  //   let reverseDirectionX;
  //   let reverseDirectionY;
  //   let direction;
  //   let counter = 0;
  //   function animate() {
  //     //counter 300 lopps then change direction
  //         if(counter%300===0){
  //           reverseDirectionX = Math.floor(Math.random()*2) == 1 ? 1 : -1;
  //           reverseDirectionY = Math.floor(Math.random()*2) == 1 ? 1 : -1;

  //           direction =  new THREE.Vector3(0.1*reverseDirectionX, 0, 0.2*reverseDirectionY); // amount to move per frame
  //           //counter=0;
  //         }
  //          console.log(direction);
  //         bot.position.add(direction); // add to position
  //         requestAnimationFrame(animate); // keep looping
  //         counter++
  //       }
  // requestAnimationFrame(animate);
// }

// function makeFood(){
//  const food_plane_geometry = new THREE.planeGeometry( 0.3 );
//  const food_plane_material = new THREE.MeshBasicMaterial( {color: 0x66669, wireframe: false} );

//  let gameBorderPosition = 100;

//  for (var i = 0; i < 10; i++) {
//    const food = new THREE.Mesh( food_plane_geometry, food_plane_material );

//    let xPostion = Math.floor(Math.random()*gameBorderPosition);
//    xPostion *= Math.floor(Math.random()*2) == 1 ? 1 : -1;

//    let zPostion = Math.floor(Math.random()*gameBorderPosition);
//    zPostion *= Math.floor(Math.random()*2) == 1 ? 1 : -1;

//    food.position.x = xPostion;
//    food.position.y = 0;
//    food.position.z = zPostion;
//    scene.add( food );
//  }
// };
