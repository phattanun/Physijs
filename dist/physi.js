(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
	typeof define === 'function' && define.amd ? define(factory) :
	global.physijs = factory();
}(this, function () { 'use strict';

	var MESSAGE_TYPES = {
		REPORTS: {
			/**
			 * world report containing matrix data for rigid bodies
			 * element [1] is number of rigid bodies in the array
			 * 2...n elements are the bodies' matrix data
			 */
			WORLD: 0
		},

		/**
		 * initializes the physics world
		 * [broadphase] String either 'sap' or 'naive' [default 'sap']
		 * [gravity] Object with float properties `x`, `y`, `z` [default {x:0, y:-9.8, z:0} ]
		 */
		INITIALIZE: 'INITIALIZE',

		/**
		 * adds a rigid body to the world
		 * body_id Integer unique integer id for the body
		 * body_type String a constant found in `BODY_TYPES`
		 * body_description Object definition corresponding to the type of rigid body (see BODY_TYPES)
		 * mass Float amount of mass the body has, 0 or Infinity creates a static object
		 */
		ADD_RIGIDBODY: 'ADD_RIGIDBODY',

		/**
		 * sets the specified rigid body's mass
		 * body_id Integer unique integer id for the body
		 * mass Float new mass value
		 */
		SET_RIGIDBODY_MASS: 'SET_RIGIDBODY_MASS',

		/**
		 * sets the specified rigid body's position & rotation
		 * body_id Integer unique integer id for the body
		 * position Object new coordinates for the body's position, {x:x, y:y, z:z}
		 * rotation Object new quaternion values {x:x, y:y, z:z, w:w}
		 */
		SET_RIGIDBODY_TRANSFORM: 'SET_RIGIDBODY_TRANSFORM',

		/**
		 * sets the specified rigid body's linear velocity
		 * body_id Integer unique integer id for the body
		 * velocity Object new coordinates for the body's linear velocity, {x:x, y:y, z:z}
		 */
		SET_RIGIDBODY_LINEAR_VELOCITY: 'SET_RIGIDBODY_LINEAR_VELOCITY',

		/**
		 * sets the specified rigid body's angular velocity
		 * body_id Integer unique integer id for the body
		 * velocity Object new coordinates for the body's angular velocity, {x:x, y:y, z:z}
		 */
		SET_RIGIDBODY_ANGULAR_VELOCITY: 'SET_RIGIDBODY_ANGULAR_VELOCITY',

		/**
		 * steps the physics simulation
		 * time_delta Float total amount of time, in seconds, to step the simulation by
		 * [max_step] Float maximum step of size, in seconds [default is value of `time_delta`]
		 */
		STEP_SIMULATION: 'STEP_SIMULATION'
	};

	function setRigidBodyAngularVelocity ( body_id, mesh ) {
		this.physijs.postMessage(
			MESSAGE_TYPES.SET_RIGIDBODY_ANGULAR_VELOCITY,
			{
				body_id: body_id,
				velocity: { x: mesh.angular_velocity.x, y: mesh.angular_velocity.y, z: mesh.angular_velocity.z }
			}
		);
	}

	function setRigidBodyLinearVelocity ( body_id, mesh ) {
		this.physijs.postMessage(
			MESSAGE_TYPES.SET_RIGIDBODY_LINEAR_VELOCITY,
			{
				body_id: body_id,
				velocity: { x: mesh.linear_velocity.x, y: mesh.linear_velocity.y, z: mesh.linear_velocity.z }
			}
		);
	}

	function setRigidBodyTransform ( body_id, mesh ) {
		this.physijs.postMessage(
			MESSAGE_TYPES.SET_RIGIDBODY_TRANSFORM,
			{
				body_id: body_id,
				position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
				rotation: { x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w }
			}
		);
	}

	function setRigidBodyMass( mesh ) {
		this.physijs.postMessage(
			MESSAGE_TYPES.SET_RIGIDBODY_MASS,
			{
				body_id: mesh.physijs.id,
				mass: mesh.physijs.mass
			}
		);
	}

	function postReport( report ) {
		this.physijs.worker.postMessage( report, [report.buffer] );
	}

	function postMessage( type, parameters ) {
		this.physijs.worker.postMessage({
			type: type,
			parameters: parameters
		});
	}

	function processWorldReport( report ) {
		var rigid_body_count = report[1];

		for ( var i = 0; i < rigid_body_count; i++ ) {
			var idx = 2 + i * 30; // [WORLD, # BODIES, n*30 elements ...]
			var rigid_body_id = report[idx++];
			var rigid_body = this.physijs.id_rigid_body_map[ rigid_body_id ];

			rigid_body.matrix.set(
				report[idx++], report[idx++], report[idx++], report[idx++],
				report[idx++], report[idx++], report[idx++], report[idx++],
				report[idx++], report[idx++], report[idx++], report[idx++],
				report[idx++], report[idx++], report[idx++], report[idx++]
			);

			rigid_body.position.copy( rigid_body.physijs.position.set( report[idx++], report[idx++], report[idx++] ) );
			rigid_body.quaternion.copy( rigid_body.physijs.quaternion.set( report[idx++], report[idx++], report[idx++], report[idx++] ) );
			rigid_body.linear_velocity.copy( rigid_body.physijs.linear_velocity.set( report[idx++], report[idx++], report[idx++] ) );
			rigid_body.angular_velocity.copy( rigid_body.physijs.angular_velocity.set( report[idx++], report[idx++], report[idx++] ) );
		}

		// send the buffer back for re-use
		this.physijs.postReport( report );

		// world report is over, we're no longer stepping
		this.physijs.is_stepping = false;
		if ( this.physijs.onStep instanceof Function ) {
			var onStep = this.physijs.onStep;
			this.physijs.onStep = null;
			onStep.call( this );
		}
	}

	function initializeWorker( worker_script_location, world_config ) {
		this.physijs.worker = new Worker( worker_script_location );
		this.physijs.worker.addEventListener(
			'message',
			function(e) {
				var data = e.data;

				if ( data instanceof Float32Array ) {
					// it's a report
					var report_type = data[0];
					if ( report_type === MESSAGE_TYPES.REPORTS.WORLD ) {
						this.physijs.processWorldReport( data );
					}
				}
			}.bind( this )
		);
		this.physijs.postMessage( MESSAGE_TYPES.INITIALIZE, world_config || {} );
	}

	function Scene( worker_script_location, world_config ) {
		THREE.Scene.call( this );

		this.physijs = {
			is_stepping: false,
			id_rigid_body_map: {},
			onStep: null,

			initializeWorker: initializeWorker.bind( this ),
			processWorldReport: processWorldReport.bind( this ),
			postMessage: postMessage.bind( this ),
			postReport: postReport.bind( this ),
			setRigidBodyMass: setRigidBodyMass.bind( this ),
			setRigidBodyTransform: setRigidBodyTransform.bind( this ),
			setRigidBodyLinearVelocity: setRigidBodyLinearVelocity.bind( this ),
			setRigidBodyAngularVelocity: setRigidBodyAngularVelocity.bind( this )
		};

		this.physijs.initializeWorker( worker_script_location, world_config );
	}

	Scene.prototype = Object.create( THREE.Scene.prototype );
	Scene.prototype.constructor = Scene;

	var BODY_TYPES = {
		/**
		 * radius Float radius of the sphere
		 */
		SPHERE: 'SPHERE',

		/**
		 * width Float box extent on x axis
		 * height Float box extent on y axis
		 * depth Float box extent on z axis
		 */
		BOX: 'BOX'
	}

	var nextId = 0;
	function getUniqueId() {
		return nextId++;
	}

	function Mesh( geometry, material, mass ) {
		if ( mass == null ) {
			throw new Error( 'Physijs: attempted to create rigid body without specifying mass' );
		}

		THREE.Mesh.call( this, geometry, material );
		this.rotationAutoUpdate = false;
		this.matrixAutoUpdate = false;

		this.physijs = {
			id: getUniqueId(),
			mass: mass || Infinity,
			position: new THREE.Vector3(),
			quaternion: new THREE.Quaternion(),
			linear_velocity: new THREE.Vector3(),
			angular_velocity: new THREE.Vector3()
		};

		this.linear_velocity = new THREE.Vector3();
		this.angular_velocity = new THREE.Vector3();
	}

	Mesh.prototype = Object.create( THREE.Mesh.prototype );
	Mesh.prototype.constructor = Mesh;

	Object.defineProperty(
		Mesh.prototype,
		'mass',
		{
			get: function() {
				return this.physijs.mass;
			},
			set: function( mass ) {
				this.physijs.mass = mass;
				if ( this.parent != null ) {
					this.parent.setRigidBodyMass( this );
				}
			}
		}
	);

	function BoxMesh( geometry, material, mass ) {
		Mesh.call( this, geometry, material, mass );
	}

	BoxMesh.prototype = Object.create( Mesh.prototype );
	BoxMesh.prototype.constructor = BoxMesh;

	function SphereMesh( geometry, material, mass ) {
		Mesh.call( this, geometry, material, mass );
	}

	SphereMesh.prototype = Object.create( Mesh.prototype );
	SphereMesh.prototype.constructor = SphereMesh;

	function getRigidBodyDefinition( mesh ) {
		var body_type;
		var body_definition = {};

		if ( mesh instanceof SphereMesh ) {
			mesh.geometry.computeBoundingSphere(); // make sure bounding radius has been calculated
			body_type = BODY_TYPES.SPHERE;
			body_definition.radius = mesh.geometry.boundingSphere.radius;
		} else if ( mesh instanceof BoxMesh ) {
			mesh.geometry.computeBoundingBox(); // make sure bounding radius has been calculated
			body_type = BODY_TYPES.BOX;
			body_definition.width = mesh.geometry.boundingBox.max.x;
			body_definition.height = mesh.geometry.boundingBox.max.y;
			body_definition.depth = mesh.geometry.boundingBox.max.z;
		} else {
			throw new Error( 'Physijs: unable to determine rigid body definition for mesh' );
		}

		return {
			body_id: mesh.physijs.id,
			body_type: body_type,
			body_definition: body_definition,
			mass: mesh.physijs.mass
		};
	}

	Scene.prototype.add = function( object ) {
		THREE.Scene.prototype.add.call( this, object );

		if ( object instanceof Mesh ) {
			var rigid_body_definition = getRigidBodyDefinition( object );
			this.physijs.id_rigid_body_map[ rigid_body_definition.body_id ] = object;
			this.physijs.postMessage( MESSAGE_TYPES.ADD_RIGIDBODY, rigid_body_definition );
			this.physijs.setRigidBodyTransform( rigid_body_definition.body_id, object );
		}
	};

	Scene.prototype.step = function( time_delta, max_step, onStep ) {
		if ( this.physijs.is_stepping === true ) {
			throw new Error( 'Physijs: scene is already stepping, cannot call step() until it\'s finished' );
		}

		this.physijs.is_stepping = true;
		this.physijs.onStep = onStep;

		// check if any rigid bodies have been toyed with
		var rigid_body_ids = Object.keys( this.physijs.id_rigid_body_map );
		for ( var i = 0; i < rigid_body_ids.length; i++ ) {
			var rigid_body_id = rigid_body_ids[ i ];
			var rigid_body = this.physijs.id_rigid_body_map[ rigid_body_id ];

			// check position/rotation
			if ( !rigid_body.position.equals( rigid_body.physijs.position ) || !rigid_body.quaternion.equals( rigid_body.physijs.quaternion ) ) {
				this.physijs.setRigidBodyTransform( rigid_body_id, rigid_body );
			}

			// check linear velocity
			if ( !rigid_body.linear_velocity.equals( rigid_body.physijs.linear_velocity ) ) {
				this.physijs.setRigidBodyLinearVelocity( rigid_body_id, rigid_body );
			}

			// check angular velocity
			if ( !rigid_body.angular_velocity.equals( rigid_body.physijs.angular_velocity ) ) {
				this.physijs.setRigidBodyAngularVelocity( rigid_body_id, rigid_body );
			}
		}

		this.physijs.postMessage(
			MESSAGE_TYPES.STEP_SIMULATION,
			{
				time_delta: time_delta,
				max_step: max_step
			}
		);
	}

	var index = {
		Mesh: Mesh,
		BoxMesh: BoxMesh,
		SphereMesh: SphereMesh,

		Scene: Scene
	};

	return index;

}));